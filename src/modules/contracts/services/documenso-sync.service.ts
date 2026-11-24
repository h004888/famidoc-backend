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
import { computeContractHoldExpiresAt } from '../pricing/doctor-quota.helper';
import { queueSigningNotices } from './signing-deadline';
import {
  hasAllFourSignatures,
  resolveSignedPdfUrl,
} from './contract-signed-pdf-gate';

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
  signingEvidenceIncomplete?: boolean;
  synced: boolean;
  contractId: string;
  contractStatus: string;
  signedRoles: SignerRole[];
  signedPdfUrl: string | null;
}

export interface SyncContractIfNeededOptions {
  /** Bỏ qua khoảng chờ giảm tần suất (dùng khi người dùng bấm cập nhật thủ công). */
  force?: boolean;
  /** Địa chỉ IP ghi vào bản ghi chữ ký khi đồng bộ thành công. */
  ipAddress?: string;
  /** Ghi đè khoảng chờ giảm tần suất mặc định giữa hai lần kiểm tra Documenso. */
  cooldownMs?: number;
}

/** Khoảng chờ mặc định giữa hai lần kiểm tra Documenso cho cùng một hợp đồng. */
export const DEFAULT_SYNC_COOLDOWN_MS = 5_000;

@Injectable()
export class DocumensoSyncService {
  private readonly logger = new Logger(DocumensoSyncService.name);

  /** Gộp các lời gọi đồng thời cho cùng một hợp đồng (single-flight). */
  private readonly inFlightSyncs = new Map<
    string,
    Promise<DocumensoSyncResult | null>
  >();

  /** Mốc thời gian hoàn tất lần kiểm tra Documenso gần nhất theo hợp đồng. */
  private readonly lastSyncAt = new Map<string, number>();

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
      select: { id: true, contractStatus: true },
    });

    const recipients = (payload.payload?.recipients ?? []).map((r) => ({
      recipientId: r.id,
      signingStatus: r.signingStatus ?? r.status,
      completedAt: r.signedAt ?? r.completedAt ?? null,
    }));

    if (contract) {
      if (['TERMINATED', 'EXPIRED'].includes(contract.contractStatus)) {
        return { ok: true, ignored: true };
      }
      await this.applySignedRecipients(contract.id, recipients, ipAddress);
      return { ok: true, contractId: contract.id };
    }

    const staffingContract = await this.prisma.b2bStaffingContract.findFirst({
      where: { documensoEnvelopeId: envelopeId },
      select: { id: true },
    });

    if (!staffingContract) {
      this.logger.warn(
        `Nhận webhook Documenso (${eventType}) nhưng không khớp hợp đồng (envelopeId=${envelopeId})`,
      );
      return { ok: true, ignored: true };
    }

    await this.applyStaffingSignedRecipients(
      staffingContract.id,
      recipients,
      ipAddress,
    );

    return { ok: true, contractId: staffingContract.id };
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

    if (
      !contract.documensoEnvelopeId ||
      ['TERMINATED', 'EXPIRED'].includes(contract.contractStatus)
    ) {
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

    return this.applySignedRecipients(contract.id, recipients, ipAddress, true);
  }

  /**
   * Đồng bộ tiến độ ký từ Documenso theo kiểu "best effort" phục vụ màn hình
   * theo dõi: gộp các lời gọi đồng thời cùng hợp đồng (single-flight), giảm tần
   * suất bằng cooldown và **fail-open** (trả `null` thay vì ném lỗi) để nhịp
   * polling nền không bị gián đoạn khi Documenso tạm thời không phản hồi.
   *
   * `force: true` bỏ qua cooldown để người dùng ép kiểm tra ngay khi bấm
   * `"Cập nhật tiến độ"`.
   */
  async syncContractIfNeeded(
    contractId: string,
    options: SyncContractIfNeededOptions = {},
  ): Promise<DocumensoSyncResult | null> {
    const inFlight = this.inFlightSyncs.get(contractId);
    if (inFlight) {
      return inFlight;
    }

    const cooldownMs = options.cooldownMs ?? DEFAULT_SYNC_COOLDOWN_MS;
    const lastSyncedAt = this.lastSyncAt.get(contractId);
    if (
      !options.force &&
      lastSyncedAt !== undefined &&
      Date.now() - lastSyncedAt < cooldownMs
    ) {
      return null;
    }

    const run = (async (): Promise<DocumensoSyncResult | null> => {
      try {
        return await this.syncContractFromDocumenso(
          contractId,
          options.ipAddress?.slice(0, 45) || 'documenso-sync',
        );
      } catch (error) {
        this.logger.warn(
          `Bỏ qua lần kiểm tra Documenso cho hợp đồng ${contractId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return null;
      } finally {
        // Ghi nhận cả lần thất bại để không dội yêu cầu liên tục vào Documenso.
        this.lastSyncAt.set(contractId, Date.now());
        this.inFlightSyncs.delete(contractId);
      }
    })();

    this.inFlightSyncs.set(contractId, run);
    return run;
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
    completeSnapshot = false,
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

      if (['TERMINATED', 'EXPIRED'].includes(contract.contractStatus)) {
        return {
          shouldSendPaymentNotice: false,
          result: {
            synced: false,
            contractId: contract.id,
            contractStatus: contract.contractStatus,
            signedRoles: contract.signatures.map((s) => s.signerRole),
            signedPdfUrl: null,
          } satisfies DocumensoSyncResult,
        };
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

      const familyAlreadySigned = signedRoles.has('FAMILY_REP');
      let signingEvidenceIncomplete = Boolean(
        contract.signingDeadlineAt && completeSnapshot &&
        !(['FAMILY_REP', 'HEALTHCARE_FACILITY', 'ASSIGNED_DOCTOR', 'ADMIN'] as const)
          .every(role => signedRoles.has(role) || matchedEntries.some(({ matched, remote }) =>
            matched.signerRole === role && Boolean(remote.signingStatus ?? remote.status),
          )),
      );
      for (const { remote, matched } of matchedEntries) {
        const remoteStatus = remote.signingStatus ?? remote.status;
        const isCompleted =
          remoteStatus === 'SIGNED' ||
          remoteStatus === 'COMPLETED' ||
          Boolean(remote.completedAt);
        if (!isCompleted) continue;

        const role = matched.signerRole;
        if (contract.signingDeadlineAt && !signedRoles.has(role)) {
          const signedTime = Date.parse(remote.completedAt ?? '');
          if (!Number.isFinite(signedTime)) {
            signingEvidenceIncomplete = true;
            continue;
          }
          if (signedTime >= contract.signingDeadlineAt.getTime()) continue;
        }
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

      const allFourSigned = hasAllFourSignatures(signedRoles);
      if (contract.signingDeadlineAt && !familyAlreadySigned && signedRoles.has('FAMILY_REP') && !allFourSigned) {
        await queueSigningNotices(tx, contract.id, contract.signingDeadlineAt);
      }

      let finalStatus = contract.contractStatus;
      let shouldSendPaymentNotice = false;
      const updateData: Prisma.MedicalContractUpdateInput = {};

      if (
        allFourSigned &&
        contract.contractStatus === 'PENDING_APPROVAL'
      ) {
        if ((contract as { creditSourceContractId?: string | null }).creditSourceContractId) {
          updateData.contractStatus = 'PAID_PENDING_APPROVAL';
          updateData.approvalDeadlineAt = new Date(
            Date.now() + 24 * 60 * 60 * 1000,
          );
          finalStatus = 'PAID_PENDING_APPROVAL';
        } else {
          updateData.contractStatus = 'PENDING_PAYMENT';
          if (contract.signingDeadlineAt) updateData.holdExpiresAt = computeContractHoldExpiresAt();
          finalStatus = 'PENDING_PAYMENT';
          shouldSendPaymentNotice = true;
        }
      } else if (
        allFourSigned &&
        contract.contractStatus === 'PAID_PENDING_APPROVAL'
      ) {
        const now = new Date();
        updateData.contractStatus = 'ACTIVE';
        updateData.documensoSignedAt = now;
        updateData.startDate = now;
        updateData.platformSignRetryPending = false;
        finalStatus = 'ACTIVE';
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
          ...(signingEvidenceIncomplete ? { signingEvidenceIncomplete: true } : {}),
          contractId: contract.id,
          contractStatus: finalStatus,
          signedRoles: Array.from(signedRoles),
          signedPdfUrl:
            allFourSigned || finalStatus === 'ACTIVE'
              ? resolveSignedPdfUrl(contract.id, {
                  documensoItemId: contract.documensoItemId,
                  contractStatus: finalStatus,
                  signedRoles,
                })
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

  async syncStaffingContractFromDocumenso(
    contractId: string,
    ipAddress = 'documenso-sync',
  ): Promise<{
    synced: boolean;
    contractId: string;
    status: string;
    facilitySigned: boolean;
    adminSigned: boolean;
    signedPdfUrl: string | null;
  }> {
    const contract = await this.prisma.b2bStaffingContract.findUnique({
      where: { id: contractId },
      select: {
        id: true,
        status: true,
        documensoEnvelopeId: true,
        documensoItemId: true,
        facilitySignedAt: true,
        adminSignedAt: true,
        signedPdfUrl: true,
      },
    });

    if (!contract) {
      throw new NotFoundException('Không tìm thấy hợp đồng cung ứng nhân lực');
    }

    if (!contract.documensoEnvelopeId) {
      return {
        synced: false,
        contractId: contract.id,
        status: contract.status,
        facilitySigned: Boolean(contract.facilitySignedAt),
        adminSigned: Boolean(contract.adminSignedAt),
        signedPdfUrl: contract.signedPdfUrl,
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

    return this.applyStaffingSignedRecipients(
      contract.id,
      recipients,
      ipAddress,
    );
  }

  async applyStaffingSignedRecipients(
    contractId: string,
    rawRecipients: Array<{
      recipientId?: number;
      signingStatus?: string;
      status?: string;
      completedAt?: string | null;
    }>,
    ipAddress: string,
  ): Promise<{
    synced: boolean;
    contractId: string;
    status: string;
    facilitySigned: boolean;
    adminSigned: boolean;
    signedPdfUrl: string | null;
  }> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM b2b_staffing_contracts WHERE id = ${contractId}::uuid FOR UPDATE`;

      const contract = await tx.b2bStaffingContract.findUnique({
        where: { id: contractId },
        include: { facility: { select: { userId: true, facilityName: true } } },
      });

      if (!contract) {
        throw new NotFoundException('Không tìm thấy hợp đồng cung ứng nhân lực');
      }

      if (
        ['TERMINATED', 'EXPIRED', 'REVISION_REQUESTED', 'ACTIVE'].includes(
          contract.status,
        )
      ) {
        return {
          synced: false,
          contractId: contract.id,
          status: contract.status,
          facilitySigned: Boolean(contract.facilitySignedAt),
          adminSigned: Boolean(contract.adminSignedAt),
          signedPdfUrl: contract.signedPdfUrl,
        };
      }

      const byRecipientId = new Map<
        number,
        { isCompleted: boolean; completedAt: Date }
      >();
      for (const r of rawRecipients) {
        if (typeof r.recipientId !== 'number') continue;
        const remoteStatus = r.signingStatus ?? r.status;
        const isCompleted =
          remoteStatus === 'SIGNED' ||
          remoteStatus === 'COMPLETED' ||
          Boolean(r.completedAt);
        byRecipientId.set(r.recipientId, {
          isCompleted,
          completedAt: r.completedAt ? new Date(r.completedAt) : new Date(),
        });
      }

      const facilityRemote =
        typeof contract.facilityDocumensoRecipientId === 'number'
          ? byRecipientId.get(contract.facilityDocumensoRecipientId)
          : undefined;
      const adminRemote =
        typeof contract.adminDocumensoRecipientId === 'number'
          ? byRecipientId.get(contract.adminDocumensoRecipientId)
          : undefined;

      let facilitySignedAt = contract.facilitySignedAt;
      let adminSignedAt = contract.adminSignedAt;
      let nextStatus = contract.status;
      let nextSignedPdfUrl = contract.signedPdfUrl;
      const updateData: Prisma.B2bStaffingContractUncheckedUpdateInput = {};

      if (!facilitySignedAt && facilityRemote?.isCompleted) {
        facilitySignedAt = facilityRemote.completedAt;
        updateData.facilitySignedAt = facilitySignedAt;
        if (nextStatus === 'PENDING_FACILITY_SIGNATURE') {
          nextStatus = 'PENDING_ADMIN_SIGNATURE';
          updateData.status = 'PENDING_ADMIN_SIGNATURE';
        }
      }

      // Sequential rule: Admin can only finalize after Facility has signed.
      if (facilitySignedAt && !adminSignedAt && adminRemote?.isCompleted) {
        adminSignedAt = adminRemote.completedAt;
        updateData.adminSignedAt = adminSignedAt;
        if (
          nextStatus === 'PENDING_FACILITY_SIGNATURE' ||
          nextStatus === 'PENDING_ADMIN_SIGNATURE'
        ) {
          nextStatus = 'ACTIVE';
          updateData.status = 'ACTIVE';
          if (contract.documensoItemId) {
            nextSignedPdfUrl = `/api/v1/contracts/staffing/${contract.id}/signed-pdf`;
            updateData.signedPdfUrl = nextSignedPdfUrl;
          }
        }
      }

      if (Object.keys(updateData).length > 0) {
        updateData.updatedAt = new Date();
        await tx.b2bStaffingContract.update({
          where: { id: contract.id },
          data: updateData,
        });

        await tx.auditLog.create({
          data: {
            actorUserId: contract.facility.userId,
            action:
              nextStatus === 'ACTIVE'
                ? 'STAFFING_CONTRACT_ACTIVATED_DOCUMENSO'
                : 'STAFFING_CONTRACT_FACILITY_SIGNED_DOCUMENSO',
            resourceName: 'B2bStaffingContract',
            resourceId: contract.id,
            clientIp: ipAddress.slice(0, 45) || 'documenso-sync',
            timestamp: new Date(),
          },
        });

        if (nextStatus === 'PENDING_ADMIN_SIGNATURE') {
          const admins = await tx.user.findMany({
            where: { role: 'ADMIN', status: 'ACTIVE' },
            select: { id: true },
          });
          for (const admin of admins) {
            await tx.notification.create({
              data: {
                userId: admin.id,
                title: 'CSYT đã ký hợp đồng B2B — Chờ Admin ký kích hoạt',
                content: `${contract.facility.facilityName} đã ký hợp đồng B2B ${contract.contractCode}. Vui lòng kiểm tra và ký số bước cuối.`,
                type: 'STAFFING_CONTRACT_FACILITY_SIGNED',
              },
            });
          }
        } else if (nextStatus === 'ACTIVE' && contract.facility.userId) {
          await tx.notification.create({
            data: {
              userId: contract.facility.userId,
              title: 'Hợp đồng B2B đã chính thức có hiệu lực',
              content: `Hợp đồng B2B ${contract.contractCode} đã được cả hai bên ký số hoàn tất. Bạn có thể bắt đầu tạo tài khoản bác sĩ.`,
              type: 'STAFFING_CONTRACT_ACTIVE',
            },
          });
        }
      }

      return {
        synced: true,
        contractId: contract.id,
        status: nextStatus,
        facilitySigned: Boolean(facilitySignedAt),
        adminSigned: Boolean(adminSignedAt),
        signedPdfUrl: nextSignedPdfUrl,
      };
    });
  }
}
