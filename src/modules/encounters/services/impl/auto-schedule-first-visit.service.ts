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
  getTimeWindowMinutes,
  parseTimeToDate,
} from './encounters.service.impl';

const VIETNAM_OFFSET_MS = 7 * 60 * 60 * 1000;
const CANDIDATE_SLOTS = ['08:30', '09:30', '10:30', '14:00', '15:00', '16:00'];
const SEARCH_WINDOW_DAYS = 30;

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
        members: true,
      },
    });
    if (!contract || !contract.doctorId) return null;

    const existing = await tx.encounter.findFirst({
      where: {
        contractId,
        category: EncounterCategory.PERIODIC_ROUTINE,
        encounterStatus: { not: EncounterStatus.CANCELLED },
      },
      select: { id: true },
    });
    if (existing) return null;

    const encounterType =
      contract.remainingHomeVisits > 0
        ? EncounterType.HOME_VISIT
        : contract.remainingTelehealth > 0
          ? EncounterType.TELEHEALTH
          : null;
    if (!encounterType) return null;

    const vnNow = new Date(now.getTime() + VIETNAM_OFFSET_MS);
    let chosenDate: Date | null = null;
    let chosenTimeStr: string | null = null;

    for (let offset = 1; offset <= SEARCH_WINDOW_DAYS; offset++) {
      const candidateDate = new Date(
        Date.UTC(
          vnNow.getUTCFullYear(),
          vnNow.getUTCMonth(),
          vnNow.getUTCDate() + offset,
        ),
      );
      if (candidateDate >= contract.endDate) break;
      if (candidateDate.getUTCDay() === 0) continue; // Skip Sunday

      const existingEncounters = await tx.encounter.findMany({
        where: {
          doctorId: contract.doctorId,
          scheduledDate: candidateDate,
          encounterStatus: {
            in: [
              EncounterStatus.CONFIRMED,
              EncounterStatus.REQUESTED,
              EncounterStatus.IN_PROGRESS,
            ],
          },
        },
      });

      for (const slot of CANDIDATE_SLOTS) {
        const slotTime = parseTimeToDate(slot);
        const startMin = getTimeWindowMinutes(slotTime);
        const endMin = startMin + APPOINTMENT_DURATION_MINUTES;

        const hasEncounterConflict = existingEncounters.some((e) => {
          const eStart = getTimeWindowMinutes(e.scheduledTime);
          const eEnd = eStart + APPOINTMENT_DURATION_MINUTES;
          return startMin < eEnd && endMin > eStart;
        });
        if (hasEncounterConflict) continue;

        chosenDate = candidateDate;
        chosenTimeStr = slot;
        break;
      }

      if (chosenDate) break;
    }

    const notifications: Prisma.NotificationUncheckedCreateInput[] = [];

    if (!chosenDate || !chosenTimeStr) {
      notifications.push({
        userId: contract.familyUnit.representativeUserId,
        title: 'Hợp đồng đã kích hoạt — Vui lòng chọn lịch khám đầu tiên',
        content:
          'Bác sĩ hiện kín lịch trong 14 ngày tới. Vui lòng vào mục Lịch hẹn để đề xuất thời gian khám phù hợp.',
        type: 'ENCOUNTER_MANUAL_SCHEDULE_REQUIRED',
        referenceId: contract.id,
      });
      if (contract.doctor?.user?.id) {
        notifications.push({
          userId: contract.doctor.user.id,
          title: 'Hộ gia đình mới kích hoạt — Cần sắp lịch khám đầu tiên',
          content: `Hộ gia đình ${contract.familyUnit.representativeUser.fullName} vừa kích hoạt hợp đồng nhưng lịch 14 ngày tới đã kín. Vui lòng chủ động sắp lịch.`,
          type: 'ENCOUNTER_MANUAL_SCHEDULE_REQUIRED',
          referenceId: contract.id,
        });
      }
      await tx.notification.createMany({ data: notifications });
      return null;
    }

    const encounter = await tx.encounter.create({
      data: {
        contractId: contract.id,
        doctorId: contract.doctorId,
        encounterType,
        category: EncounterCategory.PERIODIC_ROUTINE,
        visitScope: EncounterVisitScope.FAMILY,
        scheduledDate: chosenDate,
        scheduledTime: parseTimeToDate(chosenTimeStr),
        encounterStatus: EncounterStatus.CONFIRMED,
        cancelReason: 'Lịch khám gia đình định kỳ đầu tiên (tự động chốt sau thanh toán)',
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

    if (encounterType === EncounterType.HOME_VISIT) {
      await tx.medicalContract.update({
        where: { id: contract.id },
        data: { remainingHomeVisits: { decrement: 1 } },
      });
    } else if (encounterType === EncounterType.TELEHEALTH) {
      await tx.medicalContract.update({
        where: { id: contract.id },
        data: { remainingTelehealth: { decrement: 1 } },
      });
    }

    const dateLabel = chosenDate.toISOString().slice(0, 10);
    const doctorName = contract.doctor?.doctorName || 'Bác sĩ phụ trách';

    notifications.push({
      userId: contract.familyUnit.representativeUserId,
      title: 'Đã chốt lịch khám gia đình đầu tiên',
      content: `Hợp đồng đã kích hoạt! Hệ thống đã xếp và chốt lịch khám lúc ${chosenTimeStr} ngày ${dateLabel} với ${doctorName}. Nếu bận, bạn có thể gửi yêu cầu đổi lịch.`,
      type: 'ENCOUNTER_AUTO_CONFIRMED',
      referenceId: encounter.id,
    });

    if (contract.doctor?.user?.id) {
      notifications.push({
        userId: contract.doctor.user.id,
        title: 'Lịch khám gia đình mới đã được chốt',
        content: `Hộ gia đình ${contract.familyUnit.representativeUser.fullName} vừa kích hoạt gói. Lịch khám đã chốt: ${chosenTimeStr} ngày ${dateLabel}.`,
        type: 'ENCOUNTER_AUTO_CONFIRMED',
        referenceId: encounter.id,
      });
    }

    if (contract.facility?.userId) {
      notifications.push({
        userId: contract.facility.userId,
        title: 'Đồng bộ lịch khám gia đình mới',
        content: `Bác sĩ ${doctorName} có lịch khám đã chốt với hộ gia đình ${contract.familyUnit.representativeUser.fullName} lúc ${chosenTimeStr} ngày ${dateLabel}.`,
        type: 'ENCOUNTER_AUTO_CONFIRMED',
        referenceId: encounter.id,
      });
    }

    await tx.notification.createMany({ data: notifications });
    return encounter;
  }
}
