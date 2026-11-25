import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { PrismaService } from '../../../../core/database/prisma.service';

@Injectable()
export class EncounterRemindersService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private timer?: NodeJS.Timeout;
  private readonly logger = new Logger(EncounterRemindersService.name);

  constructor(private readonly prisma: PrismaService) {}

  onApplicationBootstrap() {
    if (process.env.ENCOUNTER_REMINDERS_ENABLED === 'false') return;

    const run = () => {
      void this.runReminders().catch((err) =>
        this.logger.error('Failed to run encounter reminders job', err),
      );
    };

    run();
    // Run reminder check every 15 minutes (900,000 ms)
    this.timer = setInterval(run, 900_000);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async runReminders() {
    const now = new Date();

    // 1. T-24 Hours Reminder Window (between 23h and 25h from now)
    const start24h = new Date(now.getTime() + 23 * 3600_000);
    const end24h = new Date(now.getTime() + 25 * 3600_000);

    // 2. T-2 Hours Reminder Window (between 1h45m and 2h15m from now)
    const start2h = new Date(now.getTime() + 105 * 60_000);
    const end2h = new Date(now.getTime() + 135 * 60_000);

    const minDate = new Date(now.getTime() - 24 * 3600_000);
    const maxDate = new Date(now.getTime() + 3 * 86_400_000);

    const upcomingEncounters = await this.prisma.encounter.findMany({
      where: {
        encounterStatus: 'CONFIRMED',
        scheduledDate: {
          gte: minDate,
          lte: maxDate,
        },
      },
      include: {
        contract: {
          include: {
            familyUnit: {
              include: { representativeUser: true },
            },
          },
        },
        participants: {
          include: { patient: true },
        },
        doctor: {
          include: { user: true },
        },
      },
    });

    const notificationsToCreate: Array<{
      userId: string;
      title: string;
      content: string;
      type: string;
      referenceId: string;
    }> = [];

    for (const enc of upcomingEncounters) {
      // Calculate appointment exact timestamp
      const encDate = new Date(enc.scheduledDate);
      const encTime = new Date(enc.scheduledTime);
      const exactTime = new Date(
        Date.UTC(
          encDate.getUTCFullYear(),
          encDate.getUTCMonth(),
          encDate.getUTCDate(),
          encTime.getUTCHours(),
          encTime.getUTCMinutes(),
        ),
      );

      const diffMs = exactTime.getTime() - now.getTime();
      const diffHours = diffMs / 3600_000;

      const dateStr = enc.scheduledDate.toISOString().slice(0, 10);
      const timeStr = enc.scheduledTime.toISOString().slice(11, 16);
      const participantLabel =
        enc.participants.length > 0
          ? enc.participants.map((p) => p.patient.fullName).join(', ')
          : `hộ gia đình ${enc.contract.familyUnit.representativeUser.fullName}`;

      // Check 24-hour reminder window (23.0h <= diff <= 25.0h)
      if (!enc.reminder24hSentAt && diffHours >= 23 && diffHours <= 25) {
        // Family reminder
        notificationsToCreate.push({
          userId: enc.contract.familyUnit.representativeUserId,
          title: 'Nhắc lịch khám trước 24 giờ',
          content: `Bạn có lịch khám ${enc.encounterType} cho ${participantLabel} vào ngày mai lúc ${timeStr}. Vui lòng kiểm tra lại thời gian.`,
          type: 'ENCOUNTER_REMINDER_24H',
          referenceId: enc.id,
        });

        // Doctor reminder
        if (enc.doctor.user?.id) {
          notificationsToCreate.push({
            userId: enc.doctor.user.id,
            title: 'Nhắc lịch khám bệnh nhân trước 24 giờ',
            content: `Bác sĩ có lịch khám ${enc.encounterType} cho ${participantLabel} vào ngày mai lúc ${timeStr}.`,
            type: 'ENCOUNTER_REMINDER_24H',
            referenceId: enc.id,
          });
        }

        await this.prisma.encounter.update({
          where: { id: enc.id },
          data: { reminder24hSentAt: now },
        });
      }

      // Check 2-hour reminder window (1.75h <= diff <= 2.25h)
      if (!enc.reminder2hSentAt && diffHours >= 1.75 && diffHours <= 2.25) {
        notificationsToCreate.push({
          userId: enc.contract.familyUnit.representativeUserId,
          title: 'Nhắc lịch khám trước 2 giờ',
          content: `Lịch khám ${enc.encounterType} của bạn sẽ bắt đầu sau 2 giờ nữa (${timeStr}). Xin chuẩn bị sẵn sàng.`,
          type: 'ENCOUNTER_REMINDER_2H',
          referenceId: enc.id,
        });

        if (enc.doctor.user?.id) {
          notificationsToCreate.push({
            userId: enc.doctor.user.id,
            title: 'Nhắc ca khám sắp diễn ra trong 2 giờ',
            content: `Ca khám ${enc.encounterType} cho ${participantLabel} sẽ bắt đầu lúc ${timeStr}.`,
            type: 'ENCOUNTER_REMINDER_2H',
            referenceId: enc.id,
          });
        }

        await this.prisma.encounter.update({
          where: { id: enc.id },
          data: { reminder2hSentAt: now },
        });
      }
    }

    if (notificationsToCreate.length > 0) {
      await this.prisma.notification.createMany({
        data: notificationsToCreate,
        skipDuplicates: true,
      });
      this.logger.log(`Created ${notificationsToCreate.length} automated encounter reminders.`);
    }

    const reconciledCount = await this.reconcilePostVisitEncounters(now);

    return { processed: notificationsToCreate.length + reconciledCount };
  }

  private async reconcilePostVisitEncounters(now: Date): Promise<number> {
    const candidates =
      (await this.prisma.encounter.findMany({
        where: {
          encounterStatus: { in: ['PENDING_RECORD', 'CONFIRMED'] },
          scheduledDate: { lte: now },
        },
        include: {
          doctor: { include: { user: true } },
          clinicalEmrs: { select: { id: true, isFinalized: true } },
        },
      })) ?? [];

    const overdueNotifications: Array<{
      userId: string;
      title: string;
      content: string;
      type: string;
      referenceId: string;
    }> = [];
    let updatedCount = 0;

    for (const enc of candidates) {
      if (enc.encounterStatus === 'DISPUTED' || enc.encounterStatus === 'NO_SHOW') {
        continue;
      }
      const encDate = new Date(enc.scheduledDate);
      const encTime = new Date(enc.scheduledTime);
      const endUtcMs = Date.UTC(
        encDate.getUTCFullYear(),
        encDate.getUTCMonth(),
        encDate.getUTCDate(),
        encTime.getUTCHours() - 7,
        encTime.getUTCMinutes() + 45,
      );
      const hoursSinceEnd = (now.getTime() - endUtcMs) / 3600_000;
      const hasFinalizedEmr = (enc.clinicalEmrs ?? []).some((emr) => emr.isFinalized);

      if (
        enc.encounterStatus === 'PENDING_RECORD' &&
        !hasFinalizedEmr &&
        hoursSinceEnd >= 24 &&
        enc.doctor?.user?.id
      ) {
        overdueNotifications.push({
          userId: enc.doctor.user.id,
          title: 'Nhắc hoàn tất bệnh án quá hạn 24 giờ',
          content:
            'Gia đình đã xác nhận bạn đến khám nhưng bệnh án vẫn chưa được chốt sau 24 giờ. Vui lòng hoàn tất hồ sơ khám.',
          type: 'ENCOUNTER_RECORD_OVERDUE',
          referenceId: enc.id,
        });
      }

      if (
        enc.encounterStatus === 'CONFIRMED' &&
        enc.familyConfirmedArrivalAt == null &&
        hasFinalizedEmr &&
        hoursSinceEnd >= 48
      ) {
        await this.prisma.encounter.update({
          where: { id: enc.id },
          data: { encounterStatus: 'COMPLETED' },
        });
        updatedCount += 1;
      }
    }

    if (overdueNotifications.length > 0) {
      await this.prisma.notification.createMany({
        data: overdueNotifications,
        skipDuplicates: true,
      });
    }

    return overdueNotifications.length + updatedCount;
  }
}
