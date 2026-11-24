import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import type { ContractSigningNotice } from '@prisma/client';
import { PrismaService } from '../../../core/database/prisma.service';
import { DocumensoClientService } from './documenso-client.service';
import { DocumensoSyncService } from './documenso-sync.service';
import { hasAllFourSignatures } from './contract-signed-pdf-gate';
import { SIGNING_EXPIRED_REASON } from './signing-deadline';

const MINUTE = 60_000;
const MAX_VERIFY_RETRIES = 5;
const PORTALS = {
  HEALTHCARE_FACILITY: ['csyt', 'facility', ''],
  ASSIGNED_DOCTOR: ['bacsi', 'doctor', ''],
  ADMIN: ['admin', 'admin', '/review'],
} as const;

@Injectable()
export class SigningDeadlineWorker
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(SigningDeadlineWorker.name);
  private readonly verifyFailures = new Map<string, number>();
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly documenso: DocumensoClientService,
    private readonly sync: DocumensoSyncService,
    @Optional()
    @Inject('MAILER_SERVICE')
    private readonly mailer?: {
      sendMail(options: Record<string, unknown>): Promise<unknown>;
    },
  ) {}

  onApplicationBootstrap() {
    if (process.env.NODE_ENV === 'test') return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), MINUTE);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await Promise.allSettled([
        this.expireContracts(),
        this.revokeEnvelopes(),
        this.sendNotices(),
      ]).then((results) => {
        for (const result of results) {
          if (result.status === 'rejected')
            this.logger.error(String(result.reason));
        }
      });
    } finally {
      this.running = false;
    }
  }

  async expireContracts(now = new Date()) {
    const due = await this.prisma.medicalContract.findMany({
      where: {
        contractStatus: 'PENDING_APPROVAL',
        signingDeadlineAt: { lte: now },
      },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take: 100,
      select: { id: true, documensoEnvelopeId: true },
    });
    for (const item of due) {
      try {
        if (item.documensoEnvelopeId) {
          const result = await this.sync.syncContractFromDocumenso(item.id);
          if (result.signingEvidenceIncomplete || !result.synced) {
            throw new Error('Chưa xác minh được đầy đủ chữ ký Documenso');
          }
        }
        await this.prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM medical_contracts WHERE id = ${item.id}::uuid FOR UPDATE`;
          const current = await tx.medicalContract.findUnique({
            where: { id: item.id },
            include: {
              signatures: {
                where: { addendumId: null },
                select: { signerRole: true },
              },
              invoices: {
                where: { paymentStatus: 'PAID' },
                select: { id: true },
                take: 1,
              },
            },
          });
          if (
            !current ||
            !current.signingDeadlineAt ||
            current.signingDeadlineAt > now ||
            current.contractStatus !== 'PENDING_APPROVAL' ||
            current.invoices.length ||
            current.documensoEnvelopeId !== item.documensoEnvelopeId ||
            hasAllFourSignatures(
              new Set(
                current.signatures.map((signature) => signature.signerRole),
              ),
            )
          )
            return;

          await tx.medicalContract.update({
            where: { id: item.id },
            data: {
              contractStatus: 'TERMINATED',
              terminationReason: SIGNING_EXPIRED_REASON,
              terminatedAt: now,
              holdExpiresAt: null,
              documensoItemId: null,
            },
          });
          await tx.invoice.updateMany({
            where: { contractId: item.id, paymentStatus: 'PENDING' },
            data: { paymentStatus: 'CANCELLED' },
          });
          await tx.matchingSession.updateMany({
            where: { contractId: item.id, status: 'CONFIRMED' },
            data: { status: 'EXPIRED' },
          });
          await tx.matchingQueueRequest.updateMany({
            where: { contractId: item.id, status: 'CONFIRMED' },
            data: { status: 'EXPIRED' },
          });
          await tx.contractDocumensoSigner.deleteMany({
            where: { contractId: item.id },
          });
          await tx.contractSigningNotice.updateMany({
            where: { contractId: item.id, finishedAt: null },
            data: { finishedAt: now },
          });
        });
        this.verifyFailures.delete(item.id);
      } catch (error) {
        const attempts = (this.verifyFailures.get(item.id) ?? 0) + 1;
        this.verifyFailures.set(item.id, attempts);
        if (attempts >= MAX_VERIFY_RETRIES) {
          this.logger.error(
            `[CẢNH BÁO VẬN HÀNH] Hợp đồng ${item.id} vượt ngưỡng ${MAX_VERIFY_RETRIES} lần đối chiếu Documenso thất bại khi hết hạn ký (${attempts} lần): ${String(error)}`,
          );
        } else {
          this.logger.warn(
            `Chưa thể xác minh hết hạn hợp đồng ${item.id}: ${String(error)}`,
          );
        }
        await this.prisma.medicalContract.updateMany({
          where: { id: item.id, contractStatus: 'PENDING_APPROVAL' },
          data: { updatedAt: now },
        });
      }
    }
  }

  async revokeEnvelopes() {
    const due = await this.prisma.medicalContract.findMany({
      where: {
        contractStatus: 'TERMINATED',
        terminationReason: SIGNING_EXPIRED_REASON,
        documensoEnvelopeId: { not: null },
      },
      select: { id: true, documensoEnvelopeId: true },
      orderBy: { updatedAt: 'asc' },
      take: 100,
    });
    for (const contract of due) {
      if (!contract.documensoEnvelopeId) continue;
      try {
        await this.documenso.revokeSigningEnvelope(
          contract.documensoEnvelopeId,
        );
        await this.prisma.medicalContract.updateMany({
          where: {
            id: contract.id,
            documensoEnvelopeId: contract.documensoEnvelopeId,
          },
          data: { documensoEnvelopeId: null },
        });
      } catch (error) {
        this.logger.warn(
          `Chưa thu hồi được phiên ký của hợp đồng ${contract.id}: ${String(error)}`,
        );
        await this.prisma.medicalContract.updateMany({
          where: {
            id: contract.id,
            documensoEnvelopeId: contract.documensoEnvelopeId,
          },
          data: { updatedAt: new Date() },
        });
      }
    }
  }

  async sendNotices(now = new Date()) {
    const due = await this.prisma.contractSigningNotice.findMany({
      where: { finishedAt: null, nextAttemptAt: { lte: now } },
      orderBy: { nextAttemptAt: 'asc' },
      take: 100,
    });
    for (const job of due) {
      const key = {
        contractId: job.contractId,
        role: job.role,
        kind: job.kind,
      };
      const lease = new Date(Date.now() + 5 * MINUTE);
      const claim = await this.prisma.contractSigningNotice.updateMany({
        where: { ...key, finishedAt: null, nextAttemptAt: job.nextAttemptAt },
        data: { nextAttemptAt: lease },
      });
      if (!claim.count) continue;
      try {
        await this.sendNotice(job);
        await this.prisma.contractSigningNotice.updateMany({
          where: { ...key, finishedAt: null, nextAttemptAt: lease },
          data: { finishedAt: new Date() },
        });
      } catch (error) {
        this.logger.warn(
          `Chưa gửi được email hạn ký cho hợp đồng ${job.contractId} (${job.role}): ${String(error)}`,
        );
      }
    }
  }

  private async sendNotice(job: ContractSigningNotice) {
    if (job.role === 'FAMILY_REP') return;
    const contract = await this.prisma.medicalContract.findUnique({
      where: { id: job.contractId },
      include: {
        signatures: {
          where: { addendumId: null },
          select: { signerRole: true },
        },
        documensoSigners: true,
        servicePackage: true,
        facility: { include: { user: true } },
        doctor: { include: { user: true } },
      },
    });
    const deadline = contract?.signingDeadlineAt;
    if (
      !contract ||
      !deadline ||
      Date.now() >= deadline.getTime() ||
      contract.contractStatus !== 'PENDING_APPROVAL' ||
      !contract.signatures.some(
        (signature) => signature.signerRole === 'FAMILY_REP',
      ) ||
      contract.signatures.some((signature) => signature.signerRole === job.role)
    )
      return;

    const signer = contract.documensoSigners.find(
      (candidate) => candidate.signerRole === job.role,
    );
    if (signer?.status === 'COMPLETED') return;
    const email =
      contract.documensoEnvelopeId && signer
        ? (
            await this.documenso.getEnvelope(contract.documensoEnvelopeId)
          ).recipients.find(
            (recipient) => recipient.id === signer.documensoRecipientId,
          )?.email
        : job.role === 'HEALTHCARE_FACILITY'
          ? contract.facility.user?.email
          : job.role === 'ASSIGNED_DOCTOR'
            ? contract.doctor?.user?.email
            : (
                await this.prisma.user.findFirst({
                  where: {
                    role: 'ADMIN',
                    status: 'ACTIVE',
                    email: { not: { endsWith: '.invalid' } },
                  },
                  orderBy: { createdAt: 'asc' },
                  select: { email: true },
                })
              )?.email;
    if (
      !email ||
      email.endsWith('.invalid') ||
      !this.mailer ||
      !process.env.APP_PUBLIC_URL
    ) {
      throw new Error('Thiếu địa chỉ người ký hoặc cấu hình gửi thư');
    }
    const minutes = Math.ceil((deadline.getTime() - Date.now()) / MINUTE);
    if (minutes <= 0) return;
    const [subdomain, portal, suffix] = PORTALS[job.role];
    const url = new URL(process.env.APP_PUBLIC_URL);
    url.hostname = `${subdomain}.${url.hostname}`;
    url.pathname = `/${portal}/contracts/${contract.id}${suffix}`;
    url.search = '';
    url.hash = '';
    const date = new Intl.DateTimeFormat('vi-VN', {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: 'Asia/Ho_Chi_Minh',
    }).format(deadline);
    const label =
      job.kind === 'OPEN' && minutes > 60
        ? 'Mời ký hợp đồng'
        : 'Nhắc hạn ký hợp đồng';
    if (job.kind === 'OPEN' && minutes <= 60) return;
    const fresh = await this.prisma.medicalContract.findFirst({
      where: {
        id: contract.id,
        contractStatus: 'PENDING_APPROVAL',
        signingDeadlineAt: { gt: new Date() },
        signatures: { none: { addendumId: null, signerRole: job.role } },
      },
      select: { id: true },
    });
    if (!fresh) return;
    await this.mailer.sendMail({
      to: email,
      subject: `${label} ${contract.contractNumber}`,
      messageId: `<signing-${contract.id}-${job.role}-${job.kind}@${url.hostname}>`,
      text: `Hợp đồng ${contract.contractNumber} · ${contract.servicePackage.packageName}\nHạn ký: ${date} (giờ Việt Nam), còn ${minutes} phút. Hợp đồng sẽ tự hủy nếu hết hạn mà chưa đủ chữ ký.\nXem chi tiết: ${url.href}`,
    });
  }
}
