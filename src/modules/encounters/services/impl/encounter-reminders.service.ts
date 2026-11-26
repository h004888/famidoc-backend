import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../../../../core/database/prisma.service';
import {
  computeHomeVisitDeadlines,
  type HomeVisitDeadlines,
} from '../../utils/encounter-session-window.util';
import { SlotLedgerService } from '../../../scheduling/slot-ledger.service';

@Injectable()
export class EncounterRemindersService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private timer?: NodeJS.Timeout;
  private readonly logger = new Logger(EncounterRemindersService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(SlotLedgerService)
    private readonly slotLedger?: SlotLedgerService,
  ) {}

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

  async runReminders(now: Date = new Date()) {

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
          doctor: { include: { user: true, facility: true } },
          contract: { include: { familyUnit: true } },
          clinicalEmrs: { select: { id: true, isFinalized: true } },
        },
      })) ?? [];

    const notifications: Array<{
      userId: string;
      title: string;
      content: string;
      type: string;
      referenceId: string;
    }> = [];
    let updatedCount = 0;
    let cachedAdminIds: string[] | null = null;

    const getAdminIds = async () => {
      if (cachedAdminIds !== null) return cachedAdminIds;
      const admins = (await this.prisma.user?.findMany({
        where: { role: 'ADMIN', status: 'ACTIVE' },
        select: { id: true },
      })) ?? [];
      cachedAdminIds = admins.map((a) => a.id);
      return cachedAdminIds;
    };

    for (const enc of candidates) {
      if (enc.encounterStatus === 'DISPUTED' || enc.encounterStatus === 'NO_SHOW') {
        continue;
      }

      const deadlines = computeHomeVisitDeadlines({
        scheduledDate: enc.scheduledDate,
        scheduledTime: enc.scheduledTime,
        slotWindow: enc.slotWindow,
      });
      const patch: Record<string, unknown> = {};

      this.handle21hReminder(enc, deadlines, now, notifications, patch);
      this.handleOverdueMark(enc, deadlines, now, notifications, patch);
      await this.handleEscalation(
        enc,
        deadlines,
        now,
        getAdminIds,
        notifications,
        patch,
      );
      this.handleAutoClose48h(enc, deadlines, now, patch);

      if (Object.keys(patch).length > 0) {
        await this.prisma.encounter.update({
          where: { id: enc.id },
          data: patch,
        });
        if (patch.encounterStatus === 'COMPLETED' && this.slotLedger) {
          await this.slotLedger.releaseEncounter(this.prisma as any, enc.id);
        }
        updatedCount += 1;
      }
    }

    if (notifications.length > 0) {
      await this.prisma.notification.createMany({
        data: notifications,
        skipDuplicates: true,
      });
    }

    return notifications.length + updatedCount;
  }

  private handle21hReminder(
    enc: any,
    deadlines: HomeVisitDeadlines,
    now: Date,
    notifications: Array<{ userId: string; title: string; content: string; type: string; referenceId: string }>,
    patch: Record<string, unknown>,
  ) {
    if (
      enc.doctorCompletedAt != null ||
      enc.reminder21hSentAt != null ||
      now.getTime() < deadlines.reminder21hAt.getTime() ||
      now.getTime() > deadlines.recordDeadlineAt.getTime()
    ) {
      return;
    }
    if (enc.doctor?.user?.id) {
      notifications.push({
        userId: enc.doctor.user.id,
        title: 'Nhắc hoàn tất hồ sơ khám trước 23:59',
        content:
          'Ca khám hôm nay vẫn chưa được bấm Hoàn tất. Vui lòng chốt hồ sơ các thành viên và hoàn tất trước 23:59.',
        type: 'ENCOUNTER_RECORD_DUE_SOON',
        referenceId: enc.id,
      });
    }
    patch.reminder21hSentAt = now;
  }

  private handleOverdueMark(
    enc: any,
    deadlines: HomeVisitDeadlines,
    now: Date,
    notifications: Array<{ userId: string; title: string; content: string; type: string; referenceId: string }>,
    patch: Record<string, unknown>,
  ) {
    if (
      enc.doctorCompletedAt != null ||
      enc.recordOverdueAt != null ||
      now.getTime() <= deadlines.recordDeadlineAt.getTime()
    ) {
      return;
    }
    patch.recordOverdueAt = now;
    if (enc.doctor?.user?.id) {
      notifications.push({
        userId: enc.doctor.user.id,
        title: 'Hồ sơ ca khám đã quá hạn (Mức 1)',
        content:
          'Ca khám đã quá hạn nộp hồ sơ 23:59 ngày khám. Vui lòng hoàn tất và nhập lý do nộp trễ.',
        type: 'ENCOUNTER_RECORD_OVERDUE',
        referenceId: enc.id,
      });
    }
    if (enc.doctor?.facility?.userId) {
      notifications.push({
        userId: enc.doctor.facility.userId,
        title: 'Cảnh báo bác sĩ quá hạn hồ sơ ca khám',
        content:
          'Một ca khám tại nhà thuộc cơ sở đã quá hạn 23:59 ngày khám nhưng bác sĩ chưa hoàn tất hồ sơ.',
        type: 'ENCOUNTER_RECORD_OVERDUE_ESCALATION',
        referenceId: enc.id,
      });
    }
  }

  private async handleEscalation(
    enc: any,
    deadlines: HomeVisitDeadlines,
    now: Date,
    getAdminIds: () => Promise<string[]>,
    notifications: Array<{ userId: string; title: string; content: string; type: string; referenceId: string }>,
    patch: Record<string, unknown>,
  ) {
    if (
      enc.doctorCompletedAt != null ||
      enc.overdueEscalatedAt != null ||
      now.getTime() <= deadlines.escalationAt.getTime()
    ) {
      return;
    }
    patch.overdueEscalatedAt = now;

    if (enc.familyConfirmedArrivalAt != null) {
      if (enc.doctor?.facility?.userId) {
        notifications.push({
          userId: enc.doctor.facility.userId,
          title: 'Leo thang quá hạn hồ sơ > 24 giờ',
          content:
            'Gia đình đã xác nhận bác sĩ có mặt nhưng hồ sơ ca khám vẫn chưa hoàn tất sau 24 giờ quá hạn.',
          type: 'ENCOUNTER_RECORD_OVERDUE_ESCALATION',
          referenceId: enc.id,
        });
      }
      const adminIds = await getAdminIds();
      for (const adminId of adminIds) {
        notifications.push({
          userId: adminId,
          title: 'Leo thang quá hạn hồ sơ > 24 giờ',
          content:
            'Ca khám tại nhà đã quá hạn hồ sơ trên 24 giờ sau khi gia đình xác nhận bác sĩ có mặt.',
          type: 'ENCOUNTER_RECORD_OVERDUE_ESCALATION',
          referenceId: enc.id,
        });
      }
    } else if (enc.contract?.familyUnit?.representativeUserId) {
      notifications.push({
        userId: enc.contract.familyUnit.representativeUserId,
        title: 'Xác nhận buổi khám tại nhà',
        content:
          'Vui lòng xác nhận 1 chạm buổi khám tại nhà đã diễn ra hay chưa để hệ thống hỗ trợ xử lý kịp thời.',
        type: 'ENCOUNTER_ATTENDANCE_CHECK',
        referenceId: enc.id,
      });
    }
  }

  private handleAutoClose48h(
    enc: any,
    deadlines: HomeVisitDeadlines,
    now: Date,
    patch: Record<string, unknown>,
  ) {
    if (
      enc.encounterStatus === 'CONFIRMED' &&
      enc.familyConfirmedArrivalAt == null &&
      enc.doctorCompletedAt != null &&
      now.getTime() >= deadlines.autoCloseAt.getTime()
    ) {
      patch.encounterStatus = 'COMPLETED';
    }
  }
}
