import {
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import type { Prisma, SignerRole } from '@prisma/client';
import { PrismaService } from '../../../core/database/prisma.service';
import { createTermsHash } from '../../../core/business/business-helpers';
import { calculateContractTermsHash } from '../pricing/contract-terms-hash';
import { ContractPaymentNoticeService } from './contract-payment-notice.service';
import { DocumensoClientService } from './documenso-client.service';

export interface DocumensoWebhookRecipientPayload {
  id?: number;
  email?: string;
  name?: string;
  role?: string;
  signingStatus?: string;
  status?: string;
  signedAt?: string | null;
  completedAt?: string | null;
}

export interface DocumensoWebhookBody {
  event?: string;
  createdAt?: string;
  timestamp?: string;
  payload?: {
    id?: number;
    envelopeId?: string;
    status?: string;
    completedAt?: string | null;
    recipients?: DocumensoWebhookRecipientPayload[];
  };
}

export interface DocumensoSyncResult {
  synced: boolean;
  contractId: string;
  contractStatus: string;
  signedRoles: SignerRole[];
  signedPdfUrl: string | null;
}

@Injectable()
export class DocumensoSyncService {
  private readonly logger = new Logger(DocumensoSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly documensoClient: DocumensoClientService,
    @Optional()
    private readonly paymentNotice?: ContractPaymentNoticeService,
  ) {}

  async handleWebhook(
    secretHeader: string | undefined,
    payload: DocumensoWebhookBody,
    ipAddress: string,
  ): Promise<{ ok: true; ignored?: boolean; contractId?: string }> {
    const isValid = this.documensoClient.verifyWebhookSecret(secretHeader);
    if (!isValid) {
      throw new UnauthorizedException(
        'X-Documenso-Secret không hợp lệ hoặc bị thiếu',
      );
    }

    const eventType = payload?.event;
    if (
      !eventType ||
      !['DOCUMENT_SIGNED', 'DOCUMENT_COMPLETED'].includes(eventType)
    ) {
      return { ok: true, ignored: true };
    }

    const envelopeId = payload?.payload?.envelopeId;
    if (!envelopeId) {
      return { ok: true, ignored: true };
    }

    const contract = await this.prisma.medicalContract.findFirst({
      where: { documensoEnvelopeId: envelopeId },
      select: { id: true },
    });

    if (!contract) {
      this.logger.warn(
        `Nhận webhook Documenso (${eventType}) nhưng không khớp hợp đồng (envelopeId=${envelopeId})`,
      );
      return { ok: true, ignored: true };
    }

    const recipients = (payload.payload?.recipients ?? []).map((r) => ({
      recipientId: r.id,
      signingStatus: r.signingStatus ?? r.status,
      completedAt: r.signedAt ?? r.completedAt ?? null,
    }));

    await this.applySignedRecipients(contract.id, recipients, ipAddress);

    return { ok: true, contractId: contract.id };
  }

  async syncContractFromDocumenso(
    contractId: string,
    ipAddress = 'documenso-sync',
  ): Promise<DocumensoSyncResult> {
    const contract = await this.prisma.medicalContract.findUnique({
      where: { id: contractId },
      select: {
        id: true,
        contractStatus: true,
        documensoEnvelopeId: true,
        documensoItemId: true,
        signatures: {
          where: { addendumId: null },
          select: { signerRole: true },
        },
      },
    });

    if (!contract) {
      throw new NotFoundException('Không tìm thấy hợp đồng y tế');
    }

    if (!contract.documensoEnvelopeId) {
      return {
        synced: false,
        contractId: contract.id,
        contractStatus: contract.contractStatus,
        signedRoles: contract.signatures.map((s) => s.signerRole),
        signedPdfUrl: null,
      };
    }

    const envelope = await this.documensoClient.getEnvelope(
      contract.documensoEnvelopeId,
    );

    const recipients = (envelope.recipients ?? []).map((r) => ({
      recipientId: r.id,
      signingStatus: r.signingStatus,
      completedAt: r.signedAt ?? r.completedAt ?? null,
    }));

    return this.applySignedRecipients(contract.id, recipients, ipAddress);
  }

  async applySignedRecipients(
    contractId: string,
    rawRecipients: Array<{
      recipientId?: number;
      signingStatus?: string;
      status?: string;
      completedAt?: string | null;
    }>,
    ipAddress: string,
  ): Promise<DocumensoSyncResult> {
    const txResult = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM medical_contracts WHERE id = ${contractId}::uuid FOR UPDATE`;

      const contract = await tx.medicalContract.findUnique({
        where: { id: contractId },
        include: {
          familyUnit: { select: { representativeUserId: true } },
          facility: { select: { userId: true } },
          doctor: { select: { userId: true } },
          signatures: { where: { addendumId: null } },
          documensoSigners: true,
        },
      });

      if (!contract) {
        throw new NotFoundException('Không tìm thấy hợp đồng y tế');
      }

      const signerByRecipientId = new Map(
        contract.documensoSigners.map((s) => [s.documensoRecipientId, s]),
      );
      const signedRoles = new Set<SignerRole>(
        contract.signatures.map((s) => s.signerRole),
      );
      const termsHash = calculateContractTermsHash(contract);

      const matchedEntries = rawRecipients
        .map((remote) => {
          const matched =
            typeof remote.recipientId === 'number'
              ? signerByRecipientId.get(remote.recipientId)
              : undefined;
          return matched ? { remote, matched } : null;
        })
        .filter((x): x is NonNullable<typeof x> => Boolean(x))
        .sort((a, b) =>
          a.matched.signerRole === 'FAMILY_REP'
            ? -1
            : b.matched.signerRole === 'FAMILY_REP'
              ? 1
              : 0,
        );

      let fallbackAdminUserId: string | null = null;
      const resolveUserId = async (role: SignerRole): Promise<string | null> => {
        switch (role) {
          case 'FAMILY_REP':
            return contract.familyUnit.representativeUserId;
          case 'HEALTHCARE_FACILITY':
            return contract.facility.userId;
          case 'ASSIGNED_DOCTOR':
            return contract.doctor?.userId ?? null;
          case 'ADMIN': {
            if (!fallbackAdminUserId) {
              const admin = await tx.user.findFirst({
                where: { role: 'ADMIN' },
                select: { id: true },
                orderBy: { createdAt: 'asc' },
              });
              fallbackAdminUserId = admin?.id ?? null;
            }
            return fallbackAdminUserId;
          }
        }
      };

      for (const { remote, matched } of matchedEntries) {
        const remoteStatus = remote.signingStatus ?? remote.status;
        const isCompleted =
          remoteStatus === 'SIGNED' ||
          remoteStatus === 'COMPLETED' ||
          Boolean(remote.completedAt);
        if (!isCompleted) continue;

        const role = matched.signerRole;
        if (role !== 'FAMILY_REP' && !signedRoles.has('FAMILY_REP')) {
          continue;
        }

        const completedAt = remote.completedAt
          ? new Date(remote.completedAt)
          : new Date();

        if (matched.status !== 'COMPLETED') {
          await tx.contractDocumensoSigner.update({
            where: { id: matched.id },
            data: { status: 'COMPLETED', completedAt },
          });
        }

        if (!signedRoles.has(role)) {
          const signerUserId = await resolveUserId(role);
          if (!signerUserId) continue;

          try {
            await tx.contractSignature.create({
              data: {
                contractId: contract.id,
                signerRole: role,
                signerUserId,
                documensoRecipientId: matched.documensoRecipientId,
                termsHash,
                signatureHash: createTermsHash({
                  source: 'DOCUMENSO',
                  contractId: contract.id,
                  role,
                  recipientId: matched.documensoRecipientId,
                  completedAt: completedAt.toISOString(),
                }),
                signedAt: completedAt,
                ipAddress: ipAddress.slice(0, 45),
              },
            });
            signedRoles.add(role);
          } catch (err) {
            if (
              (err as Prisma.PrismaClientKnownRequestError)?.code !== 'P2002'
            ) {
              throw err;
            }
            signedRoles.add(role);
          }
        }
      }

      const allFourSigned =
        signedRoles.has('FAMILY_REP') &&
        signedRoles.has('HEALTHCARE_FACILITY') &&
        signedRoles.has('ASSIGNED_DOCTOR') &&
        signedRoles.has('ADMIN');

      let finalStatus = contract.contractStatus;
      let shouldSendPaymentNotice = false;
      const updateData: Prisma.MedicalContractUpdateInput = {};

      if (allFourSigned && contract.contractStatus === 'PENDING_APPROVAL') {
        updateData.contractStatus = 'PENDING_PAYMENT';
        updateData.documensoSignedAt = new Date();
        finalStatus = 'PENDING_PAYMENT';
        shouldSendPaymentNotice = true;
      }

      if (Object.keys(updateData).length > 0) {
        await tx.medicalContract.update({
          where: { id: contract.id },
          data: updateData,
        });
      }

      return {
        shouldSendPaymentNotice,
        result: {
          synced: true,
          contractId: contract.id,
          contractStatus: finalStatus,
          signedRoles: Array.from(signedRoles),
          signedPdfUrl: contract.documensoItemId
            ? `/api/v1/contracts/medical/${contract.id}/signed-pdf`
            : null,
        } satisfies DocumensoSyncResult,
      };
    });

    if (txResult.shouldSendPaymentNotice) {
      try {
        await this.paymentNotice?.sendPaymentNotice(txResult.result.contractId);
      } catch (error) {
        this.logger.error(
          `Không gửi được email thông báo thanh toán sau khi đủ 4 chữ ký Documenso (${txResult.result.contractId}): ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return txResult.result;
  }
}
