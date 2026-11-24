import { Injectable } from '@nestjs/common';
import {
  EncounterCategory,
  EncounterStatus,
  EncounterType,
  EncounterVisitScope,
  Prisma,
} from '@prisma/client';
import { calculateCadenceDates } from './encounters.service.impl';
import { isValidHomeVisitAddress } from '../../../../core/business/business-helpers';
import { serializeEncounterScheduleMeta } from '../../utils/encounter-schedule-meta.util';
import {
  buildDayShiftOffsets,
  evaluateSlotWindowAvailability,
  isDayOffDate,
  listWorkingDaysInRange,
  slotWindowToScheduledTime,
  type SlotEncounterSummary,
  type SlotWindow,
} from '../../utils/two-slot-schedule.util';

const ACTIVE_BOOKED_STATUSES: EncounterStatus[] = [
  EncounterStatus.CONFIRMED,
  EncounterStatus.ON_THE_WAY,
  EncounterStatus.ARRIVED,
  EncounterStatus.IN_PROGRESS,
];

@Injectable()
export class AutoScheduleFirstVisitService {
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
    if (existing) return [];

    // AF1: Only auto-schedule HOME_VISIT; Telehealth/Online is never auto-scheduled
    if (contract.remainingHomeVisits <= 0) {
      return [];
    }

    const packageQuota = contract.servicePackage?.periodicVisitsQuota ?? 0;
    const quota =
      packageQuota > 0
        ? Math.min(packageQuota, contract.remainingHomeVisits)
        : contract.remainingHomeVisits;
    if (quota <= 0) return [];

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
      return [];
    }

    // Concurrency lock per doctor within this transaction
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

    const durationMonths = contract.servicePackage?.durationMonths ?? 12;
    const baseStart = contract.startDate ? new Date(contract.startDate) : now;
    const baseStartMidnight = new Date(
      Date.UTC(baseStart.getUTCFullYear(), baseStart.getUTCMonth(), baseStart.getUTCDate(), 0, 0, 0, 0),
    );
    const endBoundary = contract.endDate ? new Date(contract.endDate) : null;
    const effectiveEndBoundary =
      endBoundary ??
      (() => {
        const d = new Date(baseStartMidnight);
        d.setUTCMonth(d.getUTCMonth() + Math.max(1, durationMonths));
        return d;
      })();
    const allWorkingDays = listWorkingDaysInRange(baseStartMidnight, effectiveEndBoundary);
    const milestoneDates = calculateCadenceDates(
      baseStart,
      durationMonths,
      quota,
      contract.endDate ?? undefined,
    );

    const createdEncounters = [];
    let manualRequiredCount = 0;
    const doctorDayCache = new Map<string, SlotEncounterSummary[]>();
    const familyBusyDays = new Set<string>();
    const dayShiftOffsets = buildDayShiftOffsets(7);

    const loadDoctorDayEncounters = async (
      dateObj: Date,
      dayKey: string,
    ): Promise<SlotEncounterSummary[]> => {
      const cached = doctorDayCache.get(dayKey);
      if (cached) return cached;
      const rows = await tx.encounter.findMany({
        where: {
          doctorId: contract.doctorId!,
          scheduledDate: dateObj,
          encounterStatus: { in: ACTIVE_BOOKED_STATUSES },
        },
        select: {
          encounterType: true,
          scheduledTime: true,
          contract: { select: { familyId: true } },
        },
      });
      const mapped: SlotEncounterSummary[] = rows.map((r) => ({
        encounterType: r.encounterType,
        scheduledTime: r.scheduledTime,
      }));
      if (rows.some((r) => contract.familyId && r.contract?.familyId === contract.familyId)) {
        familyBusyDays.add(dayKey);
      }
      doctorDayCache.set(dayKey, mapped);
      return mapped;
    };

    const hasFamilyVisitOnDay = async (
      dateObj: Date,
      dayKey: string,
    ): Promise<boolean> => {
      if (familyBusyDays.has(dayKey)) return true;
      if (!contract.familyId) return false;
      const existingFam = await tx.encounter.findFirst({
        where: {
          scheduledDate: dateObj,
          encounterStatus: { in: ACTIVE_BOOKED_STATUSES },
          contract: { familyId: contract.familyId },
        },
        select: { id: true },
      });
      if (existingFam) {
        familyBusyDays.add(dayKey);
        return true;
      }
      return false;
    };

    for (let i = 0; i < milestoneDates.length; i++) {
      const targetDate = milestoneDates[i];
      let chosenDate: Date | null = null;
      let chosenSlot: SlotWindow | null = null;

      // AF3 (±3) then AF4 (±7), then expand across full [baseStart, endBoundary)
      const trySelectSlotOnDate = async (
        candidate: Date,
      ): Promise<{ date: Date; slot: SlotWindow } | null> => {
        if (candidate.getTime() < baseStartMidnight.getTime()) return null;
        if (endBoundary && candidate.getTime() >= endBoundary.getTime()) return null;
        if (isDayOffDate(candidate).isDayOff) return null;

        const dayKey = candidate.toISOString().slice(0, 10);

        // Rule 2: 1 family max 1 visit per day
        if (await hasFamilyVisitOnDay(candidate, dayKey)) return null;

        // Rule 3: 1 day 2 slots, max 1 family per slot (+ AF2 Telehealth gap check)
        const dayEncounters = await loadDoctorDayEncounters(candidate, dayKey);
        const morning = evaluateSlotWindowAvailability('MORNING', dayEncounters);
        const afternoon = evaluateSlotWindowAvailability('AFTERNOON', dayEncounters);

        if (!morning.available && !afternoon.available) return null;

        let slot: SlotWindow;
        if (morning.available && afternoon.available) {
          // AF2: Prefer the slot without Telehealth; otherwise alternate evenly
          if (morning.hasTelehealth && !afternoon.hasTelehealth) {
            slot = 'AFTERNOON';
          } else if (afternoon.hasTelehealth && !morning.hasTelehealth) {
            slot = 'MORNING';
          } else {
            slot = i % 2 === 0 ? 'MORNING' : 'AFTERNOON';
          }
        } else {
          slot = morning.available ? 'MORNING' : 'AFTERNOON';
        }

        return { date: candidate, slot };
      };

      const checkedKeys = new Set<string>();
      for (const offset of dayShiftOffsets) {
        const candidate = new Date(
          Date.UTC(
            targetDate.getUTCFullYear(),
            targetDate.getUTCMonth(),
            targetDate.getUTCDate() + offset,
            0,
            0,
            0,
            0,
          ),
        );
        checkedKeys.add(candidate.toISOString().slice(0, 10));
        const picked = await trySelectSlotOnDate(candidate);
        if (picked) {
          chosenDate = picked.date;
          chosenSlot = picked.slot;
          break;
        }
      }

      if (!chosenDate) {
        const remainingWorkingDays = allWorkingDays
          .filter((d) => !checkedKeys.has(d.toISOString().slice(0, 10)))
          .sort(
            (a, b) =>
              Math.abs(a.getTime() - targetDate.getTime()) -
              Math.abs(b.getTime() - targetDate.getTime()),
          );
        for (const candidate of remainingWorkingDays) {
          const picked = await trySelectSlotOnDate(candidate);
          if (picked) {
            chosenDate = picked.date;
            chosenSlot = picked.slot;
            break;
          }
        }
      }

      if (chosenDate && chosenSlot) {
        const dayKey = chosenDate.toISOString().slice(0, 10);
        const chosenTime = slotWindowToScheduledTime(chosenSlot);
        const cached = doctorDayCache.get(dayKey) ?? [];
        cached.push({
          encounterType: EncounterType.HOME_VISIT,
          scheduledTime: chosenTime,
        });
        doctorDayCache.set(dayKey, cached);
        familyBusyDays.add(dayKey);

        const milestoneNote = serializeEncounterScheduleMeta(
          {
            stage: 'AUTO_CONFIRMED',
            milestoneIndex: i + 1,
            totalMilestones: milestoneDates.length,
            slotWindow: chosenSlot,
          },
          `Khám tại nhà định kỳ lần ${i + 1}/${milestoneDates.length} (${chosenSlot === 'MORNING' ? 'Khung Sáng 08:00-11:30' : 'Khung Chiều 13:30-17:30'})`,
        );

        const encounter = await tx.encounter.create({
          data: {
            contractId: contract.id,
            doctorId: contract.doctorId,
            encounterType: EncounterType.HOME_VISIT,
            category: EncounterCategory.PERIODIC_ROUTINE,
            visitScope: EncounterVisitScope.FAMILY,
            scheduledDate: chosenDate,
            scheduledTime: chosenTime,
            encounterStatus: EncounterStatus.CONFIRMED,
            cancelReason: milestoneNote,
            ...(participantIds.length > 0
              ? {
                  participants: {
                    create: participantIds.map((patientId) => ({
                      patientId,
                    })),
                  },
                }
              : {}),
          },
        });
        createdEncounters.push(encounter);
      } else {
        // EF3: All ±7 days full -> create MANUAL_SLOT_REQUIRED for Doctor to schedule manually
        manualRequiredCount++;
        const milestoneNote = serializeEncounterScheduleMeta(
          {
            stage: 'MANUAL_SLOT_REQUIRED',
            milestoneIndex: i + 1,
            totalMilestones: milestoneDates.length,
          },
          `Mốc ${i + 1}/${milestoneDates.length} kín lịch ±7 ngày — Chờ Bác sĩ tự xếp tay`,
        );

        const encounter = await tx.encounter.create({
          data: {
            contractId: contract.id,
            doctorId: contract.doctorId,
            encounterType: EncounterType.HOME_VISIT,
            category: EncounterCategory.PERIODIC_ROUTINE,
            visitScope: EncounterVisitScope.FAMILY,
            scheduledDate: targetDate,
            scheduledTime: slotWindowToScheduledTime('MORNING'),
            encounterStatus: EncounterStatus.REQUESTED,
            cancelReason: milestoneNote,
            ...(participantIds.length > 0
              ? {
                  participants: {
                    create: participantIds.map((patientId) => ({
                      patientId,
                    })),
                  },
                }
              : {}),
          },
        });
        createdEncounters.push(encounter);
      }
    }

    const notifications: Prisma.NotificationUncheckedCreateInput[] = [];
    const familyLabel =
      contract.familyUnit?.representativeUser?.fullName || 'Hộ gia đình mới';
    const contractCode = contract.contractNumber || contract.id.slice(0, 8);
    const confirmedCount = createdEncounters.length - manualRequiredCount;

    if (contract.doctor?.user?.id) {
      notifications.push({
        userId: contract.doctor.user.id,
        title:
          manualRequiredCount > 0
            ? 'Có lịch Khám tại nhà mới & mốc cần Bác sĩ tự xếp tay'
            : 'Lịch Khám tại nhà mới đã được xếp vào lịch',
        content:
          manualRequiredCount > 0
            ? `Hệ thống đã chốt ${confirmedCount} buổi Khám tại nhà cho ${familyLabel} (HĐ ${contractCode}) và có ${manualRequiredCount} mốc kín lịch cần Bác sĩ tự xếp tay.`
            : `Hệ thống đã chốt sẵn ${confirmedCount} buổi Khám tại nhà cho ${familyLabel} (HĐ ${contractCode}) theo 2 khung Sáng/Chiều.`,
        type:
          manualRequiredCount > 0
            ? 'ENCOUNTER_MANUAL_SCHEDULE_REQUIRED'
            : 'ENCOUNTER_AUTO_CONFIRMED',
        referenceId: contract.id,
      });
    }

    if (contract.familyUnit?.representativeUserId) {
      notifications.push({
        userId: contract.familyUnit.representativeUserId,
        title: 'Thanh toán thành công — Lịch Khám tại nhà đã được xếp sẵn',
        content:
          manualRequiredCount > 0
            ? `Hệ thống đã chốt sẵn ${confirmedCount} buổi Khám tại nhà và còn ${manualRequiredCount} mốc đang chờ Bác sĩ chọn khung giờ phù hợp.`
            : `Hệ thống đã chốt sẵn ${confirmedCount} buổi Khám tại nhà theo gói chăm sóc (mỗi ngày tối đa 1 lượt). Bạn có thể đề xuất đổi lịch nếu bận đột xuất.`,
        type: 'ENCOUNTER_AUTO_CONFIRMED',
        referenceId: contract.id,
      });
    }

    if (notifications.length > 0) {
      await tx.notification.createMany({ data: notifications });
    }

    return createdEncounters;
  }
}
