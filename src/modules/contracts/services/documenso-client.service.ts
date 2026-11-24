import { timingSafeEqual } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { SignerRole } from '@prisma/client';
import { DOCUMENSO_SIGNATURE_MARKERS } from '../templates/documenso-contract-template.schema';

/** Thông tin một người ký (recipient) trong Envelope Documenso. */
export interface DocumensoRecipientInput {
  role: SignerRole;
  email: string;
  name: string;
  externalId?: string;
}

/** Dữ liệu khởi tạo Envelope bốn bên trên Documenso. */
export interface CreateDocumensoEnvelopeInput {
  contractId: string;
  contractNumber: string;
  pdfBuffer: Buffer;
  recipients: DocumensoRecipientInput[];
}

/** Kết quả tạo Envelope thành công — ID, token và URL ký cho mỗi bên. */
export interface DocumensoSignerBinding {
  role: SignerRole;
  recipientId: number;
  token: string;
  signingUrl: string;
  status: string;
  completedAt: string | null;
}

export interface DocumensoEnvelopeCreatedResult {
  envelopeId: string;
  envelopeItemId: string;
  signers: DocumensoSignerBinding[];
}

export interface DocumensoRemoteRecipient {
  id: number;
  email: string;
  name: string;
  token: string;
  signingStatus: 'NOT_SIGNED' | 'SIGNED' | 'REJECTED' | string;
  signingUrl?: string;
  signedAt?: string | null;
  completedAt?: string | null;
  role?: string;
  signingOrder?: number | null;
}

export interface DocumensoRemoteEnvelope {
  id: string;
  status: string;
  title: string;
  externalId?: string | null;
  completedAt?: string | null;
  recipients: DocumensoRemoteRecipient[];
  envelopeItems: Array<{
    id: string;
    title?: string;
    order?: number;
  }>;
}

export interface DocumensoFieldCreatePlaceholderPayload {
  type: 'SIGNATURE';
  recipientId: number;
  envelopeItemId: string;
  placeholder: string;
  width: number;
  height: number;
}

@Injectable()
export class DocumensoClientService {
  private readonly logger = new Logger(DocumensoClientService.name);

  getBaseUrl(): string {
    return (
      process.env.DOCUMENSO_API_URL?.trim() || 'https://sign.famidoc.online'
    ).replace(/\/+$/, '');
  }

  getApiToken(): string {
    return process.env.DOCUMENSO_API_TOKEN?.trim() || '';
  }

  getWebhookSecret(): string {
    return process.env.DOCUMENSO_WEBHOOK_SECRET?.trim() || '';
  }

  isConfigured(): boolean {
    return Boolean(this.getApiToken());
  }

  private async jsonFetch<T>(
    method: string,
    url: string,
    body?: unknown,
    allowMissing = false,
  ): Promise<T> {
    const apiToken = this.getApiToken();
    const headers: Record<string, string> = {
      Authorization: apiToken || '',
    };

    const opts: RequestInit = { method, headers, signal: AbortSignal.timeout(20_000) };

    if (body instanceof FormData) {
      opts.body = body;
    } else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }

    let response: Response;
    try {
      response = await fetch(url, opts);
    } catch (error) {
      this.logger.error(
        `Lỗi kết nối Documenso ${method} ${url}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw new ServiceUnavailableException(
        'Không thể kết nối tới máy chủ ký điện tử Documenso. Vui lòng thử lại sau.',
      );
    }

    const text = await response.text();
    if (allowMissing && response.status === 404) return undefined as T;
    if (!response.ok) {
      this.logger.error(
        `Documenso ${method} ${url} lỗi HTTP ${response.status}: ${text}`,
      );
      throw new ServiceUnavailableException(
        `Máy chủ ký điện tử Documenso từ chối yêu cầu (HTTP ${response.status})`,
      );
    }

    return text ? (JSON.parse(text) as T) : ({} as T);
  }

  /**
   * Tạo Envelope 4 bên trên Documenso v2 API:
   * 1. Upload PDF + tạo envelope (multipart POST /api/v2/envelope/create)
   * 2. Lấy chi tiết envelope (GET /api/v2/envelope/:id) để lấy envelopeItemId & recipientId
   * 3. Gắn 4 trường SIGNATURE theo placeholder ASCII (POST /api/v2/envelope/field/create-many)
   * 4. Rollback (POST /api/v2/envelope/delete) nếu thiếu field (< recipients.length)
   * 5. Distribute (POST /api/v2/envelope/distribute, distributionMethod: "NONE") để kích hoạt token
   */
  async createFourPartyEnvelope({
    contractId,
    contractNumber,
    pdfBuffer,
    recipients,
  }: CreateDocumensoEnvelopeInput): Promise<DocumensoEnvelopeCreatedResult> {
    return this.createEnvelopeWithOrder({
      contractId,
      contractNumber,
      pdfBuffer,
      recipients,
      title: `Hợp đồng dịch vụ y tế 4 bên - ${contractNumber}`,
      signingOrder: 'PARALLEL',
    });
  }

  /**
   * Tạo Envelope 2 bên tuần tự cho Hợp đồng cung ứng nhân lực B2B:
   * Thứ tự 1: Cơ sở Y tế (`HEALTHCARE_FACILITY`) -> Thứ tự 2: Quản trị viên (`ADMIN`).
   */
  async createTwoPartyEnvelope({
    contractId,
    contractNumber,
    pdfBuffer,
    recipients,
  }: CreateDocumensoEnvelopeInput): Promise<DocumensoEnvelopeCreatedResult> {
    return this.createEnvelopeWithOrder({
      contractId,
      contractNumber,
      pdfBuffer,
      recipients,
      title: `Hợp đồng cung ứng nhân lực B2B - ${contractNumber}`,
      signingOrder: 'SEQUENTIAL',
    });
  }

  private async createEnvelopeWithOrder({
    contractId,
    contractNumber,
    pdfBuffer,
    recipients,
    title,
    signingOrder,
  }: CreateDocumensoEnvelopeInput & {
    title: string;
    signingOrder: 'PARALLEL' | 'SEQUENTIAL';
  }): Promise<DocumensoEnvelopeCreatedResult> {
    const baseUrl = this.getBaseUrl();
    const apiToken = this.getApiToken();

    if (!apiToken) {
      throw new ServiceUnavailableException(
        'Hệ thống ký điện tử Documenso chưa được cấu hình đầy đủ (DOCUMENSO_API_TOKEN)',
      );
    }

    const normalizedEmails = recipients.map((r) => r.email.trim().toLowerCase());
    if (new Set(normalizedEmails).size !== recipients.length) {
      throw new BadRequestException(
        `Email của ${recipients.length} bên ký hợp đồng phải khác nhau để tạo phiên ký trên Documenso.`,
      );
    }

    // Bước 1: Tạo envelope kèm file PDF
    const formData = new FormData();
    const payload = {
      type: 'DOCUMENT' as const,
      title,
      externalId: contractId,
      meta: {
        distributionMethod: 'NONE' as const,
        signingOrder,
        language: 'en' as const,
        timezone: 'Asia/Ho_Chi_Minh',
      },
      recipients: recipients.map((r, i) => ({
        email: r.email.trim(),
        name: r.name.trim() || r.role,
        role: 'SIGNER' as const,
        signingOrder: i + 1,
      })),
    };
    formData.append('payload', JSON.stringify(payload));
    formData.append(
      'files',
      new Blob([new Uint8Array(pdfBuffer)], { type: 'application/pdf' }),
      `${contractNumber}.pdf`,
    );

    const createRes = await this.jsonFetch<{ id?: string; data?: { id?: string } }>(
      'POST',
      `${baseUrl}/api/v2/envelope/create`,
      formData,
    );

    const envelopeId = createRes?.id ?? createRes?.data?.id;
    if (!envelopeId) {
      throw new ServiceUnavailableException(
        'Documenso không trả về envelopeId hợp lệ',
      );
    }

    // Bước 2: Lấy chi tiết envelope để có envelopeItemId & recipients
    let envelopeData: DocumensoRemoteEnvelope;
    try {
      envelopeData = await this.getEnvelope(envelopeId);
    } catch (error) {
      await this.rollbackEnvelope(baseUrl, envelopeId);
      throw error;
    }

    const envelopeItemId = envelopeData.envelopeItems?.[0]?.id;
    if (!envelopeItemId) {
      await this.rollbackEnvelope(baseUrl, envelopeId);
      throw new ServiceUnavailableException(
        'Documenso không trả về envelopeItemId hợp lệ — đã hủy Envelope.',
      );
    }

    // Map recipient trả về từ Documenso theo email (do Documenso trả role='SIGNER')
    const remoteByEmail = new Map(
      (envelopeData.recipients ?? []).map((r) => [
        r.email.trim().toLowerCase(),
        r,
      ]),
    );
    const roleByRecipientId = new Map<number, SignerRole>();
    const fieldPayloads: DocumensoFieldCreatePlaceholderPayload[] = [];

    for (const inputRecipient of recipients) {
      const remoteRec = remoteByEmail.get(
        inputRecipient.email.trim().toLowerCase(),
      );
      const placeholder = DOCUMENSO_SIGNATURE_MARKERS[inputRecipient.role];
      if (!remoteRec || !placeholder) continue;

      roleByRecipientId.set(remoteRec.id, inputRecipient.role);
      fieldPayloads.push({
        type: 'SIGNATURE',
        recipientId: remoteRec.id,
        envelopeItemId,
        placeholder,
        width: 24,
        height: 8,
      });
    }

    if (fieldPayloads.length < recipients.length) {
      await this.rollbackEnvelope(baseUrl, envelopeId);
      throw new ServiceUnavailableException(
        `Không khớp đủ ${recipients.length} người ký từ Documenso (${fieldPayloads.length}/${recipients.length}) — đã hủy Envelope.`,
      );
    }

    // Bước 3: Gắn 4 SIGNATURE field theo placeholder ASCII
    let createdFieldCount = 0;
    try {
      const fieldRes = await this.jsonFetch<{ data?: unknown[] } | unknown[]>(
        'POST',
        `${baseUrl}/api/v2/envelope/field/create-many`,
        {
          envelopeId,
          data: fieldPayloads,
        },
      );
      const createdList = Array.isArray(fieldRes)
        ? fieldRes
        : Array.isArray(fieldRes?.data)
          ? fieldRes.data
          : [];
      createdFieldCount = createdList.length;
    } catch {
      await this.rollbackEnvelope(baseUrl, envelopeId);
      throw new ServiceUnavailableException(
        'Không thể gắn trường chữ ký lên Documenso. Envelope đã bị xóa.',
      );
    }

    if (createdFieldCount < recipients.length) {
      await this.rollbackEnvelope(baseUrl, envelopeId);
      throw new ServiceUnavailableException(
        `Chỉ tạo được ${createdFieldCount}/${recipients.length} trường chữ ký — Envelope đã bị xóa.`,
      );
    }

    // Bước 4: Distribute Envelope với distributionMethod: "NONE"
    let distributedRecipients = envelopeData.recipients ?? [];
    try {
      const distRes = await this.jsonFetch<{
        success?: boolean;
        id?: string;
        recipients?: DocumensoRemoteRecipient[];
        data?: { recipients?: DocumensoRemoteRecipient[] };
      }>('POST', `${baseUrl}/api/v2/envelope/distribute`, {
        envelopeId,
        meta: { distributionMethod: 'NONE' },
      });
      const responseRecipients =
        distRes?.recipients ?? distRes?.data?.recipients;
      if (Array.isArray(responseRecipients)) {
        distributedRecipients = responseRecipients;
      }
    } catch {
      await this.rollbackEnvelope(baseUrl, envelopeId);
      throw new ServiceUnavailableException(
        'Không thể kích hoạt (distribute) Envelope trên Documenso. Envelope đã bị xóa.',
      );
    }

    const signers: DocumensoSignerBinding[] = distributedRecipients
      .filter((r) => roleByRecipientId.has(r.id) && Boolean(r.token?.trim()))
      .map((r) => {
        const role = roleByRecipientId.get(r.id)!;
        const token = r.token.trim();
        return {
          role,
          recipientId: r.id,
          token,
          signingUrl: r.signingUrl || `${baseUrl}/sign/${token}`,
          status: r.signingStatus || 'NOT_SIGNED',
          completedAt: r.signedAt ?? r.completedAt ?? null,
        };
      });

    if (signers.length < recipients.length) {
      await this.rollbackEnvelope(baseUrl, envelopeId);
      throw new ServiceUnavailableException(
        `Documenso chỉ kích hoạt được ${signers.length}/${recipients.length} người ký — Envelope đã bị xóa.`,
      );
    }

    return {
      envelopeId,
      envelopeItemId,
      signers,
    };
  }

  async getEnvelope(envelopeId: string): Promise<DocumensoRemoteEnvelope> {
    const apiToken = this.getApiToken();
    if (!apiToken) {
      throw new ServiceUnavailableException(
        'Thiếu cấu hình DOCUMENSO_API_TOKEN để đồng bộ trạng thái ký Documenso',
      );
    }

    const result = await this.jsonFetch<
      DocumensoRemoteEnvelope | { data?: DocumensoRemoteEnvelope }
    >('GET', `${this.getBaseUrl()}/api/v2/envelope/${envelopeId}`);

    return result &&
      typeof result === 'object' &&
      'data' in result &&
      result.data
      ? result.data
      : (result as DocumensoRemoteEnvelope);
  }

  async downloadSignedItemPdf(envelopeItemId: string): Promise<Buffer> {
    const apiToken = this.getApiToken();
    if (!apiToken) {
      throw new ServiceUnavailableException(
        'Thiếu cấu hình DOCUMENSO_API_TOKEN để tải PDF đã ký từ Documenso',
      );
    }

    const url = `${this.getBaseUrl()}/api/v2/envelope/item/${envelopeItemId}/download?version=signed`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: apiToken,
        },
      });
    } catch (error) {
      this.logger.error(
        `Lỗi tải PDF đã ký từ Documenso item ${envelopeItemId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw new ServiceUnavailableException(
        'Không thể tải PDF đã ký từ Documenso. Vui lòng thử lại.',
      );
    }

    if (!response.ok) {
      throw new ServiceUnavailableException(
        `Documenso trả về HTTP ${response.status} khi tải PDF đã ký`,
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  /**
   * Xác thực header `X-Documenso-Secret` bằng so sánh hằng thời gian `timingSafeEqual`.
   */
  verifyWebhookSecret(
    secretHeader: string | undefined,
    expectedOverride?: string,
  ): boolean {
    const expectedSecret = expectedOverride ?? this.getWebhookSecret();
    if (!expectedSecret || !secretHeader) {
      return false;
    }

    const actualBuf = Buffer.from(secretHeader.trim(), 'utf8');
    const expectedBuf = Buffer.from(expectedSecret.trim(), 'utf8');

    if (actualBuf.length !== expectedBuf.length) {
      return false;
    }

    return timingSafeEqual(actualBuf, expectedBuf);
  }

  /**
   * Xóa Envelope bù trừ trên Documenso (ví dụ khi lưu hợp đồng vào DB thất bại).
   * Không ném lỗi để tránh che lấp lỗi gốc trong luồng rollback.
   */
  async deleteEnvelope(envelopeId: string): Promise<void> {
    if (!envelopeId || !this.getApiToken()) {
      return;
    }
    await this.rollbackEnvelope(this.getBaseUrl(), envelopeId);
  }

  async revokeSigningEnvelope(envelopeId: string): Promise<void> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException('Documenso chưa được cấu hình');
    }
    await this.jsonFetch<void>(
      'POST',
      `${this.getBaseUrl()}/api/v2/envelope/delete`,
      { envelopeId },
      true,
    );
  }

  private async rollbackEnvelope(
    baseUrl: string,
    envelopeId: string,
  ): Promise<void> {
    try {
      await this.jsonFetch('POST', `${baseUrl}/api/v2/envelope/delete`, {
        envelopeId,
      });
      this.logger.log(`Đã xóa envelope rác ${envelopeId}.`);
    } catch (error) {
      this.logger.error(
        `Rollback envelope ${envelopeId} thất bại: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
