import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { DocumensoClientService } from './documenso-client.service';
import { SlotLedgerService } from '../../scheduling/slot-ledger.service';

@Injectable()
export class ContractHoldCleanupService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private timer?: NodeJS.Timeout;
  private readonly logger = new Logger(ContractHoldCleanupService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    private readonly documensoClient?: DocumensoClientService,
    @Optional()
    private readonly slotLedger?: SlotLedgerService,
  ) {}

  onApplicationBootstrap() {
    if (
      process.env.NODE_ENV === 'test' ||
      process.env.CONTRACT_HOLD_CLEANUP_ENABLED === 'false'
    ) {
      return;
    }
    const run = () => {
      void this.releaseExpiredHolds().catch((err) =>
        this.logger.error(
          `Dọn dẹp giữ chỗ hợp đồng quá hạn thất bại: ${(err as Error)?.message ?? err}`,
        ),
      );
    };
    this.timer = setInterval(run, 15 * 60_000);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async releaseExpiredHolds(now = new Date()): Promise<{ released: number }> {
    const expiredDrafts = await this.prisma.medicalContract.findMany({
      where: {
        contractStatus: { in: ['PENDING_APPROVAL', 'PENDING_PAYMENT'] },
        holdExpiresAt: { lte: now },
        OR: [{ signingDeadlineAt: null }, { contractStatus: 'PENDING_PAYMENT' }],
        invoices: {
          none: { paymentStatus: 'PAID' },
        },
      },
      select: {
        id: true,
        upgradedFromId: true,
        documensoEnvelopeId: true,
      },
      take: 100,
    });

    if (expiredDrafts.length === 0) {
      return { released: 0 };
    }

    const releasedIds: Array<{ id: string; envelopeId: string | null }> = [];
    for (const draft of expiredDrafts) {
      const isRenewal = Boolean(draft.upgradedFromId);
      const updated = await this.prisma.$transaction(async (tx) => {
        const res = await tx.medicalContract.updateMany({
          where: {
            id: draft.id,
            contractStatus: { in: ['PENDING_APPROVAL', 'PENDING_PAYMENT'] },
            holdExpiresAt: { lte: now },
            OR: [{ signingDeadlineAt: null }, { contractStatus: 'PENDING_PAYMENT' }],
          },
          data: {
            contractStatus: isRenewal ? 'CANCELLED' : 'TERMINATED',
            terminationReason: isRenewal
              ? 'Quá thời hạn thanh toán gia hạn hợp đồng'
              : 'Hết thời hạn giữ chỗ hợp đồng nháp (TTL)',
            terminatedAt: now,
            documensoEnvelopeId: null,
            documensoItemId: null,
          },
        });
        if (res.count === 0) return false;
        await tx.contractDocumensoSigner?.deleteMany?.({
          where: { contractId: draft.id },
        });
        await tx.invoice.updateMany({
          where: { contractId: draft.id, paymentStatus: 'PENDING' },
          data: { paymentStatus: 'CANCELLED' },
        });
        await this.slotLedger?.releaseContractHolds(tx, draft.id);
        return true;
      });

      if (updated) {
        releasedIds.push({
          id: draft.id,
          envelopeId: draft.documensoEnvelopeId ?? null,
        });
      }
    }

    if (this.documensoClient?.deleteEnvelope) {
      for (const item of releasedIds) {
        if (!item.envelopeId) continue;
        try {
          await this.documensoClient.deleteEnvelope(item.envelopeId);
        } catch (err) {
          this.logger.warn(
            `Không hủy được phong bì Documenso ${item.envelopeId} sau khi hết hạn giữ chỗ: ${(err as Error)?.message ?? err}`,
          );
        }
      }
    }

    return { released: releasedIds.length };
  }
}
