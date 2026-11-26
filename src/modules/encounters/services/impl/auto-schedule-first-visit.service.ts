import { ConflictException, Inject, Injectable, Optional } from '@nestjs/common';
import {
  EncounterCategory,
  EncounterStatus,
  EncounterType,
  EncounterVisitScope,
  Prisma,
} from '@prisma/client';
import { isValidHomeVisitAddress } from '../../../../core/business/business-helpers';
import { serializeEncounterScheduleMeta } from '../../utils/encounter-schedule-meta.util';
import { slotWindowToScheduledTime } from '../../utils/two-slot-schedule.util';
import {
  SlotLedgerService,
  type BookingRow,
  type SlotRequest,
} from '../../../scheduling/slot-ledger.service';
import { planContractVisits } from '../../../scheduling/planner/visit-planner';

const DAY_MS = 86_400_000;
const REPLAN_HOLD_MS = 60 * 60 * 1000;

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

@Injectable()
export class AutoScheduleFirstVisitService {
  constructor(
    @Inject(SlotLedgerService)
    private readonly slotLedger?: SlotLedgerService,
  ) {}

  /**
   * Sau khi thanh toán: chuyển các ca đang HELD của hợp đồng thành BOOKED rồi
   * sinh encounter cho từng ca. Nếu hold đã hết hạn thì lập lại kế hoạch + hold
   * ngay trong cùng transaction; không còn đủ ca trống → báo bác sĩ xếp tay.
   */
  async scheduleOnContractActivated(
    tx: Prisma.TransactionClient,
    contractId: string,
    now: Date = new Date(),
  ) {
    const contract = await tx.medicalContract.findUnique({
      where: { id: contractId },
      include: {
        familyUnit: { include: { representativeUser: true } },
        doctor: { include: { user: true } },
        facility: { select: { userId: true } },
        servicePackage: true,
        members: true,
      },
    });
    if (!contract) return [];

    // EF2: Idempotency check — skip if non-cancelled PERIODIC_ROUTINE already exists
    const existing = await tx.encounter.findFirst({
      where: {
        contractId,
        category: EncounterCategory.PERIODIC_ROUTINE,
        encounterStatus: { not: EncounterStatus.CANCELLED },
      },
      select: { id: true },
    });
    if (existing) {
      await this.slotLedger?.releaseContractHolds(tx, contractId);
      return [];
    }

    const packageQuota = contract.servicePackage?.periodicVisitsQuota ?? 0;
    const homeQuota =
      contract.remainingHomeVisits <= 0
        ? 0
        : packageQuota > 0
          ? Math.min(packageQuota, contract.remainingHomeVisits)
          : contract.remainingHomeVisits;
    const videoQuota = Math.max(0, contract.remainingTelehealth ?? 0);
    // AF1: không có lượt nào cần xếp → nhả mọi ca đang giữ (nếu có) rồi dừng
    if (homeQuota + videoQuota <= 0) {
      await this.slotLedger?.releaseContractHolds(tx, contractId);
      return [];
    }

    // EF1: Validate required data (doctorId, real homeAddress)
    const hasAddress =
      isValidHomeVisitAddress(contract.homeVisitAddress) ||
      isValidHomeVisitAddress(contract.familyUnit?.homeAddress);
    if (!contract.doctorId || !hasAddress) {
      const missingReasons: string[] = [];
      if (!contract.doctorId) missingReasons.push('Bác sĩ phụ trách');
      if (!hasAddress) missingReasons.push('Địa chỉ khám tại nhà');

      const missingNotifications: Prisma.NotificationUncheckedCreateInput[] = [];
      const contractCode = contract.contractNumber || contract.id.slice(0, 8);
      if (contract.facility?.userId) {
        missingNotifications.push({
          userId: contract.facility.userId,
          title: 'Hợp đồng chưa thể xếp lịch tự động (Thiếu thông tin)',
          content: `HĐ ${contractCode} đã kích hoạt nhưng thiếu: ${missingReasons.join(', ')}. Vui lòng bổ sung và bấm xếp lịch lại.`,
          type: 'ENCOUNTER_AUTO_SCHEDULE_MISSING_DATA',
          referenceId: contract.id,
        });
      }
      if (contract.familyUnit?.representativeUserId) {
        missingNotifications.push({
          userId: contract.familyUnit.representativeUserId,
          title: 'Cần bổ sung thông tin để xếp lịch Khám tại nhà',
          content: `HĐ ${contractCode} đã kích hoạt nhưng còn thiếu: ${missingReasons.join(', ')}.`,
          type: 'ENCOUNTER_AUTO_SCHEDULE_MISSING_DATA',
          referenceId: contract.id,
        });
      }
      if (missingNotifications.length > 0) {
        await tx.notification.createMany({ data: missingNotifications });
      }
      // Không giữ ca vô thời hạn: trả ca ngay, lần xếp lại sẽ lập kế hoạch mới
      await this.slotLedger?.releaseContractHolds(tx, contractId);
      return [];
    }

    if (!this.slotLedger) return [];

    // Khóa theo bác sĩ trong transaction để hai hợp đồng không giành cùng ca
    if (typeof (tx as { $executeRaw?: unknown }).$executeRaw === 'function') {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${contract.doctorId}))`;
    }

    let participantIds = Array.isArray(contract.members)
      ? contract.members.map((m) => m.patientId)
      : [];
    if (
      participantIds.length === 0 &&
      contract.familyId &&
      typeof (tx as { patient?: { findMany?: unknown } }).patient?.findMany ===
        'function'
    ) {
      const familyPatients = await tx.patient.findMany({
        where: { familyId: contract.familyId, status: 'ACTIVE' },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
        take: contract.memberCount > 0 ? contract.memberCount : undefined,
      });
      participantIds = familyPatients.map((p) => p.id);
    }

    const tomorrow = isoDate(new Date(now.getTime() + DAY_MS));
    // Chỉ xác nhận ca còn hợp lệ: đúng bác sĩ hiện tại và từ ngày mai trở đi.
    let bookings: BookingRow[] = await this.slotLedger.confirmContract(
      tx,
      contract.id,
      { doctorId: contract.doctorId, minDate: tomorrow },
    );

    const bookedHome = bookings.filter((b) => b.visitType === 'HOME_VISIT').length;
    const bookedVideo = bookings.length - bookedHome;
    const missingHome = Math.max(0, homeQuota - bookedHome);
    const missingVideo = Math.max(0, videoQuota - bookedVideo);

    if (missingHome + missingVideo > 0) {
      // Hold đã hết hạn/bị nhả (toàn bộ hoặc một phần) → lập kế hoạch lại cho phần còn thiếu
      const durationMonths = contract.servicePackage?.durationMonths ?? 12;
      const baseStart = contract.startDate ? new Date(contract.startDate) : now;
      const startMidnight = new Date(
        Date.UTC(
          baseStart.getUTCFullYear(),
          baseStart.getUTCMonth(),
          baseStart.getUTCDate(),
        ),
      );
      const endBoundary = contract.endDate
        ? new Date(contract.endDate)
        : (() => {
            const d = new Date(startMidnight);
            d.setUTCMonth(d.getUTCMonth() + Math.max(1, durationMonths));
            return d;
          })();
      const startIso = isoDate(startMidnight);
      const endIso = isoDate(endBoundary);

      const occupied = await this.slotLedger.listOccupied(
        tx,
        contract.doctorId,
        startIso,
        endIso,
        { excludeContractId: contract.id },
      );
      const plan = planContractVisits({
        startDate: startIso,
        endDate: endIso,
        homeVisits: missingHome,
        videoVisits: missingVideo,
        occupied: occupied.map((o) => ({
          date: o.date,
          slotWindow: o.slotWindow,
        })),
        familyBusyDates: [
          ...new Set([
            ...bookings.map((b) => b.date),
            ...(contract.familyId
              ? await this.slotLedger.listFamilyBusyDates(
                  tx,
                  contract.familyId,
                  startIso,
                  endIso,
                  { excludeContractId: contract.id },
                )
              : []),
          ]),
        ],
        earliestDate: tomorrow,
      });

      if (!plan.ok) {
        await this.notifyManualRequired(tx, contract);
      } else {
        const slots: SlotRequest[] = plan.visits.map((v) => ({
          date: v.date,
          slotWindow: v.slotWindow,
          visitType: v.visitType,
        }));
        try {
          await this.slotLedger.hold(tx, {
            doctorId: contract.doctorId,
            contractId: contract.id,
            slots,
            expiresAt: new Date(now.getTime() + REPLAN_HOLD_MS),
          });
        } catch (error) {
          if (
            error instanceof ConflictException &&
            (error.getResponse() as { code?: string })?.code === 'SLOT_TAKEN'
          ) {
            // Ca vừa bị giành: nhả phần đã giữ dở (không xác nhận lẻ ngoài ý muốn)
            // rồi báo bác sĩ xếp tay.
            await this.slotLedger.releaseContractHolds(tx, contract.id);
            await this.notifyManualRequired(tx, contract);
          } else {
            throw error;
          }
        }
        bookings = [
          ...bookings,
          ...(await this.slotLedger.confirmContract(tx, contract.id)),
        ];
      }
    }

    if (bookings.length === 0) return [];

    const ordered = [...bookings].sort((a, b) =>
      a.date === b.date
        ? a.slotWindow.localeCompare(b.slotWindow)
        : a.date.localeCompare(b.date),
    );

    const createdEncounters = [];
    for (let i = 0; i < ordered.length; i++) {
      const booking = ordered[i];
      const isHome = booking.visitType === 'HOME_VISIT';
      const label = isHome ? 'Khám tại nhà' : 'Khám qua video';
      const windowLabel =
        booking.slotWindow === 'MORNING'
          ? 'Khung Sáng 08:00-11:30'
          : 'Khung Chiều 13:30-17:30';
      const milestoneNote = serializeEncounterScheduleMeta(
        {
          stage: 'AUTO_CONFIRMED',
          milestoneIndex: i + 1,
          totalMilestones: ordered.length,
          slotWindow: booking.slotWindow,
        },
        `${label} định kỳ lần ${i + 1}/${ordered.length} (${windowLabel})`,
      );

      const encounter = await tx.encounter.create({
        data: {
          contractId: contract.id,
          doctorId: contract.doctorId,
          encounterType: isHome
            ? EncounterType.HOME_VISIT
            : EncounterType.TELEHEALTH,
          category: EncounterCategory.PERIODIC_ROUTINE,
          visitScope: EncounterVisitScope.FAMILY,
          scheduledDate: new Date(`${booking.date}T00:00:00.000Z`),
          scheduledTime: slotWindowToScheduledTime(booking.slotWindow),
          slotWindow: booking.slotWindow,
          encounterStatus: EncounterStatus.CONFIRMED,
          cancelReason: milestoneNote,
          ...(participantIds.length > 0
            ? {
                participants: {
                  create: participantIds.map((patientId) => ({ patientId })),
                },
              }
            : {}),
        },
      });
      await this.slotLedger.attachEncounter(tx, booking.id, encounter.id);
      createdEncounters.push(encounter);
    }

    await this.notifyConfirmed(tx, contract, createdEncounters.length);
    return createdEncounters;
  }

  private async notifyConfirmed(
    tx: Prisma.TransactionClient,
    contract: ContractForNotify,
    confirmedCount: number,
  ) {
    const notifications: Prisma.NotificationUncheckedCreateInput[] = [];
    const familyLabel =
      contract.familyUnit?.representativeUser?.fullName || 'Hộ gia đình mới';
    const contractCode = contract.contractNumber || contract.id.slice(0, 8);

    if (contract.doctor?.user?.id) {
      notifications.push({
        userId: contract.doctor.user.id,
        title: 'Lịch Khám tại nhà mới đã được xếp vào lịch',
        content: `Hệ thống đã chốt sẵn ${confirmedCount} buổi khám cho ${familyLabel} (HĐ ${contractCode}) theo 2 khung Sáng/Chiều.`,
        type: 'ENCOUNTER_AUTO_CONFIRMED',
        referenceId: contract.id,
      });
    }
    if (contract.familyUnit?.representativeUserId) {
      notifications.push({
        userId: contract.familyUnit.representativeUserId,
        title: 'Thanh toán thành công — Lịch Khám tại nhà đã được xếp sẵn',
        content: `Hệ thống đã chốt sẵn ${confirmedCount} buổi khám theo gói chăm sóc (mỗi ngày tối đa 1 lượt). Bạn có thể đề xuất đổi lịch nếu bận đột xuất.`,
        type: 'ENCOUNTER_AUTO_CONFIRMED',
        referenceId: contract.id,
      });
    }
    if (notifications.length > 0) {
      await tx.notification.createMany({ data: notifications });
    }
  }

  private async notifyManualRequired(
    tx: Prisma.TransactionClient,
    contract: ContractForNotify,
  ) {
    const notifications: Prisma.NotificationUncheckedCreateInput[] = [];
    const familyLabel =
      contract.familyUnit?.representativeUser?.fullName || 'Hộ gia đình mới';
    const contractCode = contract.contractNumber || contract.id.slice(0, 8);

    if (contract.doctor?.user?.id) {
      notifications.push({
        userId: contract.doctor.user.id,
        title: 'Có hợp đồng mới cần Bác sĩ tự xếp lịch',
        content: `Lịch của bạn không còn đủ ca trống để hệ thống tự xếp cho ${familyLabel} (HĐ ${contractCode}). Vui lòng chọn ca thủ công.`,
        type: 'ENCOUNTER_MANUAL_SCHEDULE_REQUIRED',
        referenceId: contract.id,
      });
    }
    if (contract.familyUnit?.representativeUserId) {
      notifications.push({
        userId: contract.familyUnit.representativeUserId,
        title: 'Thanh toán thành công — Lịch khám đang chờ Bác sĩ xếp',
        content: `HĐ ${contractCode} đã kích hoạt nhưng chưa xếp được lịch tự động. Bác sĩ sẽ chọn khung giờ phù hợp cho gia đình.`,
        type: 'ENCOUNTER_AUTO_CONFIRMED',
        referenceId: contract.id,
      });
    }
    if (notifications.length > 0) {
      await tx.notification.createMany({ data: notifications });
    }
  }
}

type ContractForNotify = {
  id: string;
  contractNumber: string | null;
  familyUnit: {
    representativeUserId: string | null;
    representativeUser: { fullName: string | null } | null;
  } | null;
  doctor: { user: { id: string } | null } | null;
};
