import { Injectable } from '@nestjs/common';
import {
  EncounterCategory,
  EncounterStatus,
  EncounterType,
  EncounterVisitScope,
  Prisma,
} from '@prisma/client';
import {
  APPOINTMENT_DURATION_MINUTES,
  calculateCadenceDates,
  getTimeWindowMinutes,
  parseTimeToDate,
} from './encounters.service.impl';
import { serializeEncounterScheduleMeta } from '../../utils/encounter-schedule-meta.util';

const CANDIDATE_SLOTS = ['08:30', '09:30', '10:30', '14:00', '15:00', '16:00'];

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
    if (!contract || !contract.doctorId) return [];

    const existing = await tx.encounter.findFirst({
      where: {
        contractId,
        category: EncounterCategory.PERIODIC_ROUTINE,
        encounterStatus: { not: EncounterStatus.CANCELLED },
      },
      select: { id: true },
    });
    if (existing) return [];

    const encounterType =
      contract.remainingHomeVisits > 0
        ? EncounterType.HOME_VISIT
        : contract.remainingTelehealth > 0
          ? EncounterType.TELEHEALTH
          : null;
    if (!encounterType) return [];

    const packageQuota = contract.servicePackage?.periodicVisitsQuota ?? 0;
    const quota =
      packageQuota > 0
        ? packageQuota
        : encounterType === EncounterType.HOME_VISIT
          ? contract.remainingHomeVisits
          : contract.remainingTelehealth;

    if (quota <= 0) return [];

    const durationMonths = contract.servicePackage?.durationMonths ?? 12;
    const baseStart = contract.startDate ? new Date(contract.startDate) : now;
    const milestoneDates = calculateCadenceDates(
      baseStart,
      durationMonths,
      quota,
      contract.endDate ?? undefined,
    );

    const createdEncounters = [];
    const bookedByDay = new Map<string, number[]>();

    for (let i = 0; i < milestoneDates.length; i++) {
      const targetDate = milestoneDates[i];
      const dayKey = targetDate.toISOString().slice(0, 10);

      let occupiedStartMinutes = bookedByDay.get(dayKey);
      if (!occupiedStartMinutes) {
        const existingEncounters = await tx.encounter.findMany({
          where: {
            doctorId: contract.doctorId,
            scheduledDate: targetDate,
            encounterStatus: {
              in: [
                EncounterStatus.CONFIRMED,
                EncounterStatus.REQUESTED,
                EncounterStatus.IN_PROGRESS,
              ],
            },
          },
        });
        occupiedStartMinutes = existingEncounters.map((e) =>
          getTimeWindowMinutes(e.scheduledTime),
        );
        bookedByDay.set(dayKey, occupiedStartMinutes);
      }

      let chosenTimeStr = CANDIDATE_SLOTS[0];
      for (const slot of CANDIDATE_SLOTS) {
        const slotTime = parseTimeToDate(slot);
        const startMin = getTimeWindowMinutes(slotTime);
        const endMin = startMin + APPOINTMENT_DURATION_MINUTES;

        const hasConflict = occupiedStartMinutes.some((eStart) => {
          const eEnd = eStart + APPOINTMENT_DURATION_MINUTES;
          return startMin < eEnd && endMin > eStart;
        });
        if (!hasConflict) {
          chosenTimeStr = slot;
          break;
        }
      }

      const chosenTime = parseTimeToDate(chosenTimeStr);
      occupiedStartMinutes.push(getTimeWindowMinutes(chosenTime));

      const milestoneNote = serializeEncounterScheduleMeta(
        {
          stage: 'CADENCE_DRAFT',
          milestoneIndex: i + 1,
          totalMilestones: milestoneDates.length,
        },
        `Khám định kỳ gia đình lần ${i + 1}/${milestoneDates.length} (khung dự thảo mặc định theo gói)`,
      );

      const encounter = await tx.encounter.create({
        data: {
          contractId: contract.id,
          doctorId: contract.doctorId,
          encounterType,
          category: EncounterCategory.PERIODIC_ROUTINE,
          visitScope: EncounterVisitScope.FAMILY,
          scheduledDate: targetDate,
          scheduledTime: chosenTime,
          encounterStatus: EncounterStatus.REQUESTED,
          cancelReason: milestoneNote,
          ...(contract.members.length > 0
            ? {
                participants: {
                  create: contract.members.map((m) => ({
                    patientId: m.patientId,
                  })),
                },
              }
            : {}),
        },
      });
      createdEncounters.push(encounter);
    }

    const notifications: Prisma.NotificationUncheckedCreateInput[] = [];
    const familyLabel =
      contract.familyUnit?.representativeUser?.fullName || 'Hộ gia đình mới';
    const contractCode = contract.contractNumber || contract.id.slice(0, 8);

    if (contract.doctor?.user?.id) {
      notifications.push({
        userId: contract.doctor.user.id,
        title: 'Khung lịch khám định kỳ mặc định mới cần duyệt',
        content: `Hệ thống đã tự động tạo ${createdEncounters.length} mốc khám định kỳ dự thảo cho ${familyLabel} (HĐ ${contractCode}). Vui lòng rà soát, điều chỉnh nếu cần và chốt gửi gia đình.`,
        type: 'ENCOUNTER_CADENCE_DRAFT_READY',
        referenceId: contract.id,
      });
    }

    if (contract.familyUnit?.representativeUserId) {
      notifications.push({
        userId: contract.familyUnit.representativeUserId,
        title: 'Hợp đồng đã kích hoạt — Đang lập lộ trình khám định kỳ',
        content: `Hệ thống đã khởi tạo ${createdEncounters.length} mốc khám định kỳ dự kiến theo gói chăm sóc và gửi Bác sĩ phụ trách rà soát. Bạn sẽ nhận thông báo xác nhận ngay khi Bác sĩ chốt lịch.`,
        type: 'ENCOUNTER_CADENCE_DRAFT_READY',
        referenceId: contract.id,
      });
    }

    if (notifications.length > 0) {
      await tx.notification.createMany({ data: notifications });
    }

    return createdEncounters;
  }
}
