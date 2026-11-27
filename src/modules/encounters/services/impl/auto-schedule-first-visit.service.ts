import { ConflictException, Inject, Injectable } from '@nestjs/common';
import {
  EncounterCategory,
  EncounterStatus,
  EncounterType,
  EncounterVisitScope,
  Prisma,
} from '@prisma/client';
import {
  isValidHomeVisitAddress,
  todayInVietnam,
} from '../../../../core/business/business-helpers';
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

/** R7: "ngày mai" tính theo lịch Việt Nam (UTC+7), không theo UTC. */
export const tomorrowInVietnamIso = (now: Date) =>
  isoDate(new Date(todayInVietnam(now).getTime() + DAY_MS));

@Injectable()
export class AutoScheduleFirstVisitService {
  constructor(
    @Inject(SlotLedgerService)
    private readonly slotLedger?: SlotLedgerService,
  ) {}

  /**
   * Sau khi thanh toán: CHỈ tự xếp các buổi khám tại nhà (R2). Buổi khám video
   * không tự xếp — gia đình tự đặt lịch với bác sĩ (R3).
   * Chuyển ca HELD khám tại nhà thành BOOKED, xếp bù phần còn thiếu, tạo encounter.
   * Không đủ ca trống → xếp được bao nhiêu chốt bấy nhiêu, phần còn lại báo xếp tay (R18).
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

    // R2: chỉ tính quota khám tại nhà, không dùng quota video.
    const packageQuota = contract.servicePackage?.periodicVisitsQuota ?? 0;
    const homeQuota =
      contract.remainingHomeVisits <= 0
        ? 0
        : packageQuota > 0
          ? Math.min(packageQuota, contract.remainingHomeVisits)
          : contract.remainingHomeVisits;
    if (homeQuota <= 0) {
      await this.slotLedger?.releaseContractHolds(tx, contractId);
      return [];
    }

    // R4: idempotent — chỉ xếp phần còn thiếu so với các buổi khám tại nhà định kỳ đang hiệu lực.
    const existingActive = await tx.encounter.count({
      where: {
        contractId,
        category: EncounterCategory.PERIODIC_ROUTINE,
        encounterType: EncounterType.HOME_VISIT,
        encounterStatus: {
          notIn: [EncounterStatus.CANCELLED, EncounterStatus.COMPLETED],
        },
      },
    });
    const needed = Math.max(0, homeQuota - existingActive);
    if (needed <= 0) {
      await this.slotLedger?.releaseContractHolds(tx, contractId);
      return [];
    }

    // R5: phải có bác sĩ phụ trách và địa chỉ khám tại nhà.
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
          title: 'Hợp đồng chưa thể xếp lịch tự động (thiếu thông tin)',
          content: `Hợp đồng ${contractCode} đã kích hoạt nhưng còn thiếu: ${missingReasons.join(', ')}. Vui lòng bổ sung và bấm "Xếp lịch lại".`,
          type: 'ENCOUNTER_AUTO_SCHEDULE_MISSING_DATA',
          referenceId: contract.id,
        });
      }
      if (contract.familyUnit?.representativeUserId) {
        missingNotifications.push({
          userId: contract.familyUnit.representativeUserId,
          title: 'Cần bổ sung thông tin để xếp lịch khám tại nhà',
          content: `Hợp đồng ${contractCode} đã kích hoạt nhưng còn thiếu: ${missingReasons.join(', ')}.`,
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

    // R6: khóa theo bác sĩ trong transaction để hai hợp đồng không giành cùng ca
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

    // R7 + R8: chỉ chốt ca khám tại nhà còn hợp lệ — đúng bác sĩ, từ ngày mai (giờ VN).
    const tomorrow = tomorrowInVietnamIso(now);
    let bookings: BookingRow[] = (
      await this.slotLedger.confirmContract(tx, contract.id, {
        doctorId: contract.doctorId,
        minDate: tomorrow,
        onlyVisitType: 'HOME_VISIT',
      })
    ).filter((b) => b.visitType === 'HOME_VISIT');
    if (bookings.length > needed) {
      // Chỉ dùng đúng số buổi còn thiếu; ca dư được nhả lại.
      const surplus = bookings.slice(needed);
      bookings = bookings.slice(0, needed);
      if (typeof (tx as { $executeRawUnsafe?: unknown }).$executeRawUnsafe === 'function') {
        await tx.$executeRawUnsafe(
          `DELETE FROM doctor_slot_bookings WHERE id = ANY($1::uuid[]) AND encounter_id IS NULL`,
          surplus.map((b) => b.id),
        );
      }
    }

    let missing = needed - bookings.length;
    let manualRequired = false;

    if (missing > 0) {
      // R9: khoảng xếp lịch trong thời hạn hợp đồng
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

      // R12: bỏ ca đã có người
      const occupied = await this.slotLedger.listOccupied(
        tx,
        contract.doctorId,
        startIso,
        endIso,
        { excludeContractId: contract.id },
      );
      // R13: tối đa 1 buổi/ngày/gia đình
      const familyBusyDates = [
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
      ];
      const planInput = {
        startDate: startIso,
        endDate: endIso,
        videoVisits: 0,
        occupied: occupied.map((o) => ({
          date: o.date,
          slotWindow: o.slotWindow,
        })),
        familyBusyDates,
        earliestDate: tomorrow,
      };
      let plan = planContractVisits({ ...planInput, homeVisits: missing });
      if (!plan.ok) {
        // R18: không đủ ngày trống → xếp được bao nhiêu chốt bấy nhiêu.
        manualRequired = true;
        plan =
          plan.available > 0
            ? planContractVisits({ ...planInput, homeVisits: plan.available })
            : { ok: true, visits: [] };
      }

      if (plan.ok && plan.visits.length > 0) {
        const slots: SlotRequest[] = plan.visits.map((v) => ({
          date: v.date,
          slotWindow: v.slotWindow,
          visitType: 'HOME_VISIT',
        }));
        try {
          await this.slotLedger.hold(tx, {
            doctorId: contract.doctorId,
            contractId: contract.id,
            slots,
            expiresAt: new Date(now.getTime() + REPLAN_HOLD_MS),
          });
          const confirmed = await this.slotLedger.confirmContract(
            tx,
            contract.id,
          );
          bookings = [
            ...bookings,
            ...confirmed.filter((b) => b.visitType === 'HOME_VISIT'),
          ];
        } catch (error) {
          if (
            error instanceof ConflictException &&
            (error.getResponse() as { code?: string })?.code === 'SLOT_TAKEN'
          ) {
            // R17: ca vừa bị giành → nhả phần HELD giữ dở, giữ BOOKED đã chốt, chuyển xếp tay.
            await this.slotLedger.releaseContractHolds(tx, contract.id);
            manualRequired = true;
          } else {
            throw error;
          }
        }
      }
      missing = Math.max(0, needed - bookings.length);
      if (missing > 0) manualRequired = true;
    }

    const ordered = [...bookings].sort((a, b) =>
      a.date === b.date
        ? a.slotWindow.localeCompare(b.slotWindow)
        : a.date.localeCompare(b.date),
    );

    // R19: tạo encounter khám tại nhà; số thứ tự tính tiếp sau các buổi đã có.
    const totalMilestones = existingActive + needed;
    const createdEncounters = [];
    for (let i = 0; i < ordered.length; i++) {
      const booking = ordered[i];
      const index = existingActive + i + 1;
      const windowLabel =
        booking.slotWindow === 'MORNING'
          ? 'Khung Sáng 08:00-11:30'
          : 'Khung Chiều 13:30-17:30';
      const milestoneNote = serializeEncounterScheduleMeta(
        {
          stage: 'AUTO_CONFIRMED',
          milestoneIndex: index,
          totalMilestones,
          slotWindow: booking.slotWindow,
        },
        `Khám tại nhà định kỳ lần ${index}/${totalMilestones} (${windowLabel})`,
      );

      const encounter = await tx.encounter.create({
        data: {
          contractId: contract.id,
          doctorId: contract.doctorId,
          encounterType: EncounterType.HOME_VISIT,
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

    // Chỉ gửi MỘT loại thông báo: đủ → đã xếp; thiếu → cần bác sĩ xếp tay.
    if (manualRequired) {
      await this.notifyManualRequired(
        tx,
        contract,
        createdEncounters.length,
        needed,
      );
    } else if (createdEncounters.length > 0) {
      await this.notifyConfirmed(tx, contract, createdEncounters.length);
    }
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
        title: 'Lịch khám tại nhà mới đã được xếp',
        content: `Hệ thống đã xếp sẵn ${confirmedCount} buổi khám tại nhà cho ${familyLabel} (HĐ ${contractCode}) theo khung Sáng/Chiều.`,
        type: 'ENCOUNTER_AUTO_CONFIRMED',
        referenceId: contract.id,
      });
    }
    if (contract.familyUnit?.representativeUserId) {
      notifications.push({
        userId: contract.familyUnit.representativeUserId,
        title: 'Thanh toán thành công — Lịch khám tại nhà đã được xếp',
        content: `Hệ thống đã xếp sẵn ${confirmedCount} buổi bác sĩ đến khám tại nhà (mỗi ngày tối đa 1 buổi). Các buổi khám qua video, gia đình vui lòng tự đặt lịch với bác sĩ khi cần. Bạn có thể đề xuất đổi lịch nếu bận đột xuất.`,
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
    scheduledCount: number,
    totalCount: number,
  ) {
    const notifications: Prisma.NotificationUncheckedCreateInput[] = [];
    const familyLabel =
      contract.familyUnit?.representativeUser?.fullName || 'Hộ gia đình mới';
    const contractCode = contract.contractNumber || contract.id.slice(0, 8);
    const remaining = Math.max(0, totalCount - scheduledCount);

    if (contract.doctor?.user?.id) {
      notifications.push({
        userId: contract.doctor.user.id,
        title: 'Có hợp đồng cần bác sĩ xếp lịch khám tại nhà',
        content: `Hệ thống đã xếp được ${scheduledCount}/${totalCount} buổi khám tại nhà cho ${familyLabel} (HĐ ${contractCode}). Lịch của bạn không còn đủ ca trống cho ${remaining} buổi còn lại, vui lòng chọn ca thủ công.`,
        type: 'ENCOUNTER_MANUAL_SCHEDULE_REQUIRED',
        referenceId: contract.id,
      });
    }
    if (contract.familyUnit?.representativeUserId) {
      notifications.push({
        userId: contract.familyUnit.representativeUserId,
        title: 'Thanh toán thành công — Lịch khám tại nhà đang chờ bác sĩ xếp',
        content: `Hợp đồng ${contractCode} đã kích hoạt. Hệ thống đã xếp được ${scheduledCount}/${totalCount} buổi khám tại nhà, ${remaining} buổi còn lại bác sĩ sẽ chọn khung giờ phù hợp cho gia đình. Các buổi khám qua video, gia đình vui lòng tự đặt lịch với bác sĩ.`,
        type: 'ENCOUNTER_MANUAL_SCHEDULE_REQUIRED',
        referenceId: contract.id,
      });
    }
    if (notifications.length > 0) {
      await tx.notification.createMany({ data: notifications });
    }
  }

  /**
   * R20: gọi SAU khi rollback SAVEPOINT xếp lịch — hợp đồng vẫn ACTIVE, chỉ báo
   * CSYT + gia đình để bấm "Xếp lịch lại".
   */
  async notifyAutoScheduleFailed(
    tx: Prisma.TransactionClient,
    contractId: string,
  ) {
    const contract = await tx.medicalContract.findUnique({
      where: { id: contractId },
      select: {
        id: true,
        contractNumber: true,
        facility: { select: { userId: true } },
        familyUnit: { select: { representativeUserId: true } },
      },
    });
    if (!contract) return;
    const contractCode = contract.contractNumber || contract.id.slice(0, 8);
    const notifications: Prisma.NotificationUncheckedCreateInput[] = [];
    if (contract.facility?.userId) {
      notifications.push({
        userId: contract.facility.userId,
        title: 'Xếp lịch tự động gặp lỗi',
        content: `Hợp đồng ${contractCode} đã kích hoạt nhưng hệ thống chưa xếp được lịch khám tại nhà do lỗi xử lý. Vui lòng bấm "Xếp lịch lại".`,
        type: 'ENCOUNTER_AUTO_SCHEDULE_FAILED',
        referenceId: contract.id,
      });
    }
    if (contract.familyUnit?.representativeUserId) {
      notifications.push({
        userId: contract.familyUnit.representativeUserId,
        title: 'Thanh toán thành công — Lịch khám đang được xử lý',
        content: `Hợp đồng ${contractCode} đã kích hoạt. Lịch khám tại nhà đang được cơ sở y tế sắp xếp, gia đình sẽ nhận thông báo khi có lịch.`,
        type: 'ENCOUNTER_AUTO_SCHEDULE_FAILED',
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
