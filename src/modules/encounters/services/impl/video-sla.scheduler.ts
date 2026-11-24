import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EncounterStatus, EncounterType } from '@prisma/client';
import { PrismaService } from '../../../../core/database/prisma.service';

@Injectable()
export class VideoSlaScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(VideoSlaScheduler.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      void this.runVideoLifecycleSweep().catch((err) =>
        this.logger.warn(`Video SLA sweep failed: ${err instanceof Error ? err.message : String(err)}`),
      );
    }, 5 * 60 * 1000);
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async runVideoLifecycleSweep(now: Date = new Date()): Promise<{
    expiredRequests: number;
    noShows: number;
  }> {
    let expiredRequests = 0;
    let noShows = 0;

    // 1. Auto-expire REQUESTED encounters past SLA expiresAt
    const staleRequested = await this.prisma.encounter.findMany({
      where: {
        encounterType: EncounterType.TELEHEALTH,
        encounterStatus: EncounterStatus.REQUESTED,
        expiresAt: { lte: now },
      },
      include: {
        contract: { include: { servicePackage: true, familyUnit: true } },
      },
    });

    for (const enc of staleRequested) {
      const updated = await this.prisma.encounter.updateMany({
        where: { id: enc.id, encounterStatus: EncounterStatus.REQUESTED },
        data: {
          encounterStatus: EncounterStatus.CANCELLED,
          cancelReason: 'Tự động hủy do quá hạn phản hồi SLA',
        },
      });
      if (updated.count === 0) continue;
      expiredRequests++;

      const policy = enc.contract?.servicePackage?.videoQuotaPolicy ?? 'FIXED';
      if (policy === 'FIXED') {
        await this.prisma.medicalContract.updateMany({
          where: { id: enc.contractId, heldTelehealth: { gt: 0 } },
          data: { heldTelehealth: { decrement: 1 } },
        });
      }
    }

    // 2. Detect NO_SHOW 15 minutes after scheduled start
    const confirmedTelehealth = await this.prisma.encounter.findMany({
      where: {
        encounterType: EncounterType.TELEHEALTH,
        encounterStatus: EncounterStatus.CONFIRMED,
      },
      include: {
        telehealthSession: true,
        contract: { include: { servicePackage: true, familyUnit: true, facility: true } },
      },
    });

    for (const enc of confirmedTelehealth) {
      const dateStr = enc.scheduledDate.toISOString().slice(0, 10);
      const timeStr = enc.scheduledTime.toISOString().slice(11, 19);
      const scheduledUtcMs = new Date(`${dateStr}T${timeStr}Z`).getTime() - 7 * 60 * 60 * 1000;
      if (now.getTime() < scheduledUtcMs + 15 * 60 * 1000) {
        continue;
      }

      const doctorJoined = Boolean(enc.telehealthSession?.doctorJoinedAt);
      const updated = await this.prisma.encounter.updateMany({
        where: { id: enc.id, encounterStatus: EncounterStatus.CONFIRMED },
        data: { encounterStatus: EncounterStatus.NO_SHOW },
      });
      if (updated.count === 0) continue;
      noShows++;

      const policy = enc.contract?.servicePackage?.videoQuotaPolicy ?? 'FIXED';
      if (!doctorJoined && policy === 'FIXED') {
        await this.prisma.medicalContract.update({
          where: { id: enc.contractId },
          data: { remainingTelehealth: { increment: 1 } },
        });
      }
    }

    if (expiredRequests > 0 || noShows > 0) {
      this.logger.log(`Video SLA sweep: expired=${expiredRequests}, noShows=${noShows}`);
    }

    return { expiredRequests, noShows };
  }
}
