import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../../../../core/auth/authenticated-request';
import { isValidHomeVisitAddress } from '../../../../core/business/business-helpers';
import {
  AutoScheduleErrorCode,
  ContractErrorCode,
} from '../../../../core/constants/error-codes.constant';
import {
  BaseApiException,
  ResourceNotFoundException,
} from '../../../../core/exceptions/api.exception';
import {
  ENCOUNTERS_REPOSITORY_TOKEN,
  type EncountersSession,
  type IEncountersRepository,
} from '../../repositories/interfaces/encounters.repository.interface';
import type { IEncountersService } from '../interfaces/encounters.service.interface';
import type { CreatePeriodicEncounterDto } from '../../dtos/create-periodic-encounter.dto';
import type { CreateAdHocEncounterDto } from '../../dtos/create-adhoc-encounter.dto';
import type { FinalizeEncounterDto } from '../../dtos/finalize-encounter.dto';
import type { ConfirmEncounterDto } from '../../dtos/confirm-encounter.dto';
import type { RequestRescheduleDto } from '../../dtos/request-reschedule.dto';
import type { DecideRescheduleRequestDto } from '../../dtos/decide-reschedule-request.dto';
import type { ListEncountersQueryDto } from '../../dtos/list-encounters-query.dto';
import type { CompleteEncounterDto } from '../../dtos/complete-encounter.dto';
import type { UpdateParticipantAttendanceDto } from '../../dtos/update-participant-attendance.dto';
import {
  computeHomeVisitDeadlines,
  isRecordOverdue,
} from '../../utils/encounter-session-window.util';
import {
  EncounterCategory,
  EncounterStatus,
  EncounterType,
  EncounterVisitScope,
  Prisma,
  RescheduleDecision,
} from '@prisma/client';
import {
  enrichEncounterWithScheduleMeta,
  parseEncounterScheduleMeta,
  serializeEncounterScheduleMeta,
} from '../../utils/encounter-schedule-meta.util';
import {
  evaluateVideoSlotWindowAvailability,
} from '../../utils/two-slot-schedule.util';
import {
  evaluateSlotWindowAvailability,
  isDayOffDate,
  listWorkingDaysInRange,
  mapTimeToSlotWindow,
  slotWindowToScheduledTime,
  type SlotEncounterSummary,
} from '../../utils/two-slot-schedule.util';
import { AutoScheduleFirstVisitService } from './auto-schedule-first-visit.service';
import {
  SlotLedgerService,
  type OccupiedSlot,
  type SlotWindowName,
} from '../../../scheduling/slot-ledger.service';

export type SlotReasonCode =
  | 'AVAILABLE'
  | 'TAKEN'
  | 'OWN_VISIT'
  | 'FAMILY_SAME_DAY'
  | 'DAY_OFF'
  | 'PAST'
  | 'OUT_OF_CONTRACT';

export function buildShiftStatus(
  dayIso: string,
  slotWindow: SlotWindowName,
  occupiedMap: Map<string, OccupiedSlot>,
  ctx: {
    todayIso: string;
    isDayOff: boolean;
    dayOffReason?: string | null;
    isOutOfContract: boolean;
    contractId?: string;
    familyBusyDays: Set<string>;
  },
): {
  available: boolean;
  reasonCode: SlotReasonCode;
  label: string;
  reason: string | null;
} {
  if (ctx.isOutOfContract) {
    return {
      available: false,
      reasonCode: 'OUT_OF_CONTRACT',
      label: 'Ngoài hạn hợp đồng',
      reason: 'Ngoài hạn hợp đồng',
    };
  }
  if (dayIso <= ctx.todayIso) {
    return {
      available: false,
      reasonCode: 'PAST',
      label: 'Đã qua',
      reason: 'Đã qua',
    };
  }
  if (ctx.isDayOff) {
    return {
      available: false,
      reasonCode: 'DAY_OFF',
      label: 'Ngày nghỉ',
      reason: ctx.dayOffReason ?? 'Ngày nghỉ',
    };
  }
  const occ = occupiedMap.get(`${dayIso}:${slotWindow}`);
  if (occ) {
    if (ctx.contractId && occ.contractId === ctx.contractId) {
      return {
        available: false,
        reasonCode: 'OWN_VISIT',
        label: 'Lịch của bạn',
        reason: 'Lịch của bạn',
      };
    }
    return {
      available: false,
      reasonCode: 'TAKEN',
      label: 'Đã có lịch',
      reason: 'Đã có lịch',
    };
  }
  if (ctx.familyBusyDays.has(dayIso)) {
    return {
      available: false,
      reasonCode: 'FAMILY_SAME_DAY',
      label: 'Gia đình đã có lượt trong ngày',
      reason: 'Gia đình đã có lượt trong ngày',
    };
  }
  return {
    available: true,
    reasonCode: 'AVAILABLE',
    label: 'Còn trống',
    reason: null,
  };
}

export const APPOINTMENT_DURATION_MINUTES = 45;
export const RESCHEDULE_MIN_NOTICE_HOURS = 4;
export const MAX_RESCHEDULE_COUNT = 3;
const CADENCE_CANDIDATE_SLOTS = ['08:30:00', '09:30:00', '10:30:00', '14:00:00', '15:00:00', '16:00:00'];

export function parseDateOnly(dateStr: string): Date {
  const parts = dateStr.split('-');
  if (parts.length !== 3) throw new BadRequestException('Invalid date format (expected YYYY-MM-DD)');
  const [y, m, d] = parts.map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
}

export function parseTimeToDate(timeStr: string, baseDate = new Date()): Date {
  const parts = timeStr.split(':');
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  const s = parts[2] ? Number(parts[2]) : 0;
  if (isNaN(h) || isNaN(m) || isNaN(s) || h < 0 || h > 23 || m < 0 || m > 59 || s < 0 || s > 59) {
    throw new BadRequestException('Invalid time format');
  }
  return new Date(Date.UTC(1970, 0, 1, h, m, s, 0));
}

function normalizeMilestoneDate(rawDate: Date, endDate?: Date): Date {
  const d = new Date(
    Date.UTC(rawDate.getUTCFullYear(), rawDate.getUTCMonth(), rawDate.getUTCDate(), 0, 0, 0, 0),
  );
  if (endDate) {
    const endMidnight = new Date(
      Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate(), 0, 0, 0, 0),
    );
    if (d.getTime() >= endMidnight.getTime()) {
      d.setTime(endMidnight.getTime() - 24 * 60 * 60 * 1000);
    }
  }
  if (d.getUTCDay() === 0) {
    const monday = new Date(d.getTime() + 24 * 60 * 60 * 1000);
    if (endDate) {
      const endMidnight = new Date(
        Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate(), 0, 0, 0, 0),
      );
      if (monday.getTime() >= endMidnight.getTime()) {
        return new Date(d.getTime() - 24 * 60 * 60 * 1000);
      }
    }
    return monday;
  }
  return d;
}

export function calculateCadenceDates(
  startDate: Date,
  durationMonths: number,
  quota: number,
  endDate?: Date,
): Date[] {
  if (quota <= 0) return [];
  const startMidnight = new Date(
    Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate(), 0, 0, 0, 0),
  );
  const rawEnd = endDate
    ? new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate(), 0, 0, 0, 0))
    : (() => {
        const d = new Date(startMidnight);
        d.setUTCMonth(d.getUTCMonth() + Math.max(1, durationMonths));
        return d;
      })();

  const effectiveSpreadStart =
    durationMonths >= 2 && quota <= durationMonths
      ? (() => {
          const d1 = new Date(startMidnight);
          d1.setUTCMonth(d1.getUTCMonth() + 1);
          return d1.getTime() < rawEnd.getTime() ? d1 : startMidnight;
        })()
      : startMidnight;

  const workingDays = listWorkingDaysInRange(effectiveSpreadStart, rawEnd);
  if (workingDays.length === 0) {
    return Array.from({ length: quota }, () => normalizeMilestoneDate(startMidnight, rawEnd));
  }

  if (quota === 1) {
    if (durationMonths >= 2) {
      return [workingDays[0]];
    }
    const idx = workingDays.length >= 3 ? Math.floor(workingDays.length / 2) : workingDays.length - 1;
    return [workingDays[idx]];
  }

  const results: Date[] = [];
  if (workingDays.length >= quota) {
    // Rải đều trên các ngày làm việc trong [startDate, endDate), tránh trùng ngày
    for (let i = 0; i < quota; i++) {
      const remainingToPick = quota - i;
      const minIdx = i === 0 ? 0 : Math.max(0, results.length > 0 ? workingDays.indexOf(results[results.length - 1]) + 1 : 0);
      const maxIdx = workingDays.length - remainingToPick;
      const idealIdx = Math.round((i * (workingDays.length - 1)) / (quota - 1));
      const clampedIdx = Math.max(minIdx, Math.min(maxIdx, idealIdx));
      results.push(workingDays[clampedIdx]);
    }
    return results;
  }

  for (let i = 0; i < quota; i++) {
    const idx = Math.min(
      workingDays.length - 1,
      Math.floor((i * workingDays.length) / quota),
    );
    results.push(workingDays[idx]);
  }
  return results;
}

export function combineDateAndTime(dateObj: Date, timeObj: Date | string): Date {
  const d = new Date(dateObj);
  let h = 0, m = 0, s = 0;
  if (typeof timeObj === 'string') {
    const parts = timeObj.split(':').map(Number);
    h = parts[0] || 0;
    m = parts[1] || 0;
    s = parts[2] || 0;
  } else if (timeObj instanceof Date) {
    h = timeObj.getUTCHours();
    m = timeObj.getUTCMinutes();
    s = timeObj.getUTCSeconds();
  }
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, m, s));
}

export function getTimeWindowMinutes(timeObj: Date | string): number {
  if (typeof timeObj === 'string') {
    const [h, m] = timeObj.split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  }
  return timeObj.getUTCHours() * 60 + timeObj.getUTCMinutes();
}

@Injectable()
export class EncountersServiceImpl implements IEncountersService {
  constructor(
    @Inject(ENCOUNTERS_REPOSITORY_TOKEN)
    private readonly repository: IEncountersRepository,
    @Inject(SlotLedgerService)
    private readonly slotLedger?: SlotLedgerService,
  ) {}

  async createPeriodicEncounter(actor: AuthenticatedUser, dto: CreatePeriodicEncounterDto) {
    if (!['DOCTOR', 'ADMIN'].includes(actor.role)) {
      throw new ForbiddenException('Only the assigned doctor or admin can plan periodic examinations');
    }

    return this.repository.transaction(async (session) => {
      const contract = await session.findContract(dto.contractId);
      if (!contract) throw new NotFoundException('Medical contract not found');
      if (contract.contractStatus !== 'ACTIVE') {
        throw new BadRequestException('Contract is not active for scheduling examinations');
      }

      let doctorId = contract.doctorId;
      if (actor.role === 'DOCTOR') {
        const doc = await session.findDoctorByUserId(actor.id);
        if (!doc) throw new NotFoundException('Doctor profile not found');
        if (contract.doctorId && contract.doctorId !== doc.id) {
          throw new ForbiddenException('You are not the assigned doctor for this contract');
        }
        doctorId = doc.id;
      }
      if (!doctorId) {
        throw new BadRequestException('Contract has no assigned doctor');
      }

      const requestedPatientIds = Array.from(
        new Set(dto.patientIds?.length ? dto.patientIds : dto.patientId ? [dto.patientId] : []),
      );
      for (const pid of requestedPatientIds) {
        const isMember = await session.isPatientInContract(pid, contract.id);
        if (!isMember) {
          throw new BadRequestException('Patient is not a covered member of this contract');
        }
      }

      const visitScope =
        dto.visitScope ??
        (requestedPatientIds.length === 1 ? EncounterVisitScope.INDIVIDUAL : EncounterVisitScope.FAMILY);

      const participantIds =
        requestedPatientIds.length > 0
          ? requestedPatientIds
          : visitScope === EncounterVisitScope.FAMILY
            ? contract.members.map((m) => m.patientId)
            : [];

      // Check quota
      if (dto.encounterType === EncounterType.HOME_VISIT && contract.remainingHomeVisits <= 0) {
        throw new BadRequestException('Contract has no remaining Home Visit quota for periodic examination');
      }
      if (dto.encounterType === EncounterType.TELEHEALTH && contract.remainingTelehealth <= 0) {
        throw new BadRequestException('Contract has no remaining Telehealth quota for periodic examination');
      }

      const scheduledDate = parseDateOnly(dto.scheduledDate);
      const scheduledTime = parseTimeToDate(dto.scheduledTime);

      const encounter = await session.createEncounter({
        contractId: contract.id,
        doctorId,
        encounterType: dto.encounterType,
        category: EncounterCategory.PERIODIC_ROUTINE,
        visitScope,
        scheduledDate,
        scheduledTime,
        encounterStatus: EncounterStatus.REQUESTED,
        cancelReason: serializeEncounterScheduleMeta(
          { stage: 'AWAITING_FAMILY_CONFIRM' },
          dto.notes ?? null,
        ),
        ...(participantIds.length > 0
          ? {
              participants: {
                create: participantIds.map((patientId) => ({ patientId })),
              },
            }
          : {}),
      });

      const periodicTx = (session as unknown as { tx?: Prisma.TransactionClient }).tx;
      if (periodicTx && this.slotLedger) {
        await this.slotLedger.book(periodicTx, {
          doctorId,
          contractId: contract.id,
          date: dto.scheduledDate,
          slotWindow:
            Number.parseInt(dto.scheduledTime.split(':')[0] || '8', 10) >= 12
              ? 'AFTERNOON'
              : 'MORNING',
          visitType: dto.encounterType === EncounterType.TELEHEALTH ? 'VIDEO' : 'HOME_VISIT',
          encounterId: encounter.id,
        });
      }

      await session.createAuditLog(actor.id, 'CREATE_PERIODIC_ENCOUNTER', encounter.id);

      await session.createNotification({
        userId: contract.familyUnit.representativeUserId,
        title: 'Lịch khám định kỳ mới được đề xuất',
        content: `Bác sĩ đã đề xuất lịch khám định kỳ cho ngày ${dto.scheduledDate} lúc ${dto.scheduledTime}. Vui lòng xác nhận.`,
        type: 'ENCOUNTER_PROPOSED',
        referenceId: encounter.id,
      });

      return enrichEncounterWithScheduleMeta(encounter);
    });
  }

  async createAdHocEncounter(actor: AuthenticatedUser, dto: CreateAdHocEncounterDto) {
    if (!['FAMILY_REP', 'ADMIN'].includes(actor.role)) {
      throw new ForbiddenException('Only family representatives or admin can submit ad-hoc examination requests');
    }

    return this.repository.transaction(async (session) => {
      const contract = await session.findContract(dto.contractId);
      if (!contract) throw new NotFoundException('Medical contract not found');
      if (contract.contractStatus !== 'ACTIVE') {
        throw new BadRequestException('Contract is not active');
      }
      if (actor.role === 'FAMILY_REP' && contract.familyUnit.representativeUserId !== actor.id) {
        throw new ForbiddenException('You are not the representative of this contract');
      }

      if (dto.encounterType === EncounterType.HOME_VISIT && actor.role === 'FAMILY_REP') {
        throw new BadRequestException(
          'Lịch khám tại nhà được hệ thống tự động sắp xếp theo gói dịch vụ. Gia đình chỉ có thể đặt lịch Tư vấn Video trực tuyến.',
        );
      }

      const videoPolicy = contract.servicePackage?.videoQuotaPolicy ?? 'FIXED';
      if (dto.encounterType === EncounterType.TELEHEALTH) {
        const held = (contract as unknown as { heldTelehealth?: number }).heldTelehealth ?? 0;
        if (videoPolicy === 'FIXED' && contract.remainingTelehealth - held <= 0) {
          throw new BadRequestException('Hạn ngạch Tư vấn Video khả dụng của hợp đồng đã hết');
        }
      }

      const requestedPatientIds = Array.from(
        new Set(dto.patientIds?.length ? dto.patientIds : dto.patientId ? [dto.patientId] : []),
      );
      for (const pid of requestedPatientIds) {
        const isMember = await session.isPatientInContract(pid, contract.id);
        if (!isMember) {
          throw new BadRequestException('Patient is not a covered member of this contract');
        }
      }
      const visitScope =
        dto.visitScope ??
        (dto.encounterType === EncounterType.TELEHEALTH && requestedPatientIds.length === 0
          ? EncounterVisitScope.FAMILY
          : requestedPatientIds.length === 1
            ? EncounterVisitScope.INDIVIDUAL
            : EncounterVisitScope.FAMILY);
      if (requestedPatientIds.length === 0 && visitScope !== EncounterVisitScope.FAMILY) {
        throw new BadRequestException('At least one patientId is required for ad-hoc encounter');
      }
      const participantIds =
        requestedPatientIds.length > 0
          ? requestedPatientIds
          : contract.members.map((m) => m.patientId);
      if (!contract.doctorId) {
        throw new BadRequestException('No attending doctor assigned to this contract');
      }

      const tx = (session as unknown as { tx?: Prisma.TransactionClient }).tx;
      if (tx && typeof (tx as { $executeRaw?: unknown }).$executeRaw === 'function') {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${contract.doctorId}))`;
      }

      const resolvedSlotWindow: 'MORNING' | 'AFTERNOON' =
        dto.slotWindow ??
        (dto.desiredTime && Number.parseInt(dto.desiredTime.split(':')[0] || '8', 10) >= 12
          ? 'AFTERNOON'
          : 'MORNING');
      const resolvedDesiredTime =
        dto.desiredTime ?? (resolvedSlotWindow === 'MORNING' ? '08:00:00' : '13:30:00');

      const scheduledDate = parseDateOnly(dto.desiredDate);
      const scheduledTime = parseTimeToDate(resolvedDesiredTime);

      if (dto.encounterType === EncounterType.TELEHEALTH && tx) {
        const openRequested = await tx.encounter.count({
          where: {
            contractId: contract.id,
            encounterType: EncounterType.TELEHEALTH,
            encounterStatus: EncounterStatus.REQUESTED,
          },
        });
        if (openRequested >= 2) {
          throw new BadRequestException(
            'Hợp đồng đã có tối đa 2 yêu cầu Tư vấn Video đang chờ duyệt.',
          );
        }
      }

      const tagPrefix =
        dto.quickTags && dto.quickTags.length > 0 ? `[${dto.quickTags.join(', ')}] ` : '';
      const rawReason = dto.reason?.trim() || '';
      const displayReason =
        `${tagPrefix}${rawReason}`.trim() || 'Tư vấn sức khỏe gia đình theo nhu cầu';

      const now = new Date();
      const slotStartMs = combineDateAndTime(scheduledDate, scheduledTime).getTime();
      const expiresAt = new Date(
        Math.min(now.getTime() + 12 * 60 * 60 * 1000, slotStartMs - 2 * 60 * 60 * 1000),
      );

      if (dto.encounterType === EncounterType.TELEHEALTH && videoPolicy === 'FIXED') {
        await session.holdTelehealthQuota(contract.id);
      }

      const encounter = await session.createEncounter({
        contractId: contract.id,
        doctorId: contract.doctorId,
        encounterType: dto.encounterType,
        category: EncounterCategory.AD_HOC_ON_DEMAND,
        visitScope,
        scheduledDate,
        scheduledTime,
        slotWindow: resolvedSlotWindow,
        quickTags: dto.quickTags ?? [],
        expiresAt,
        encounterStatus: EncounterStatus.REQUESTED,
        cancelReason: serializeEncounterScheduleMeta(
          { stage: 'AWAITING_DOCTOR_REVIEW', slotWindow: resolvedSlotWindow },
          displayReason,
        ),
        ...(participantIds.length > 0
          ? {
              participants: {
                create: participantIds.map((patientId) => ({ patientId })),
              },
            }
          : {}),
      });

      if (tx && this.slotLedger) {
        await this.slotLedger.book(tx, {
          doctorId: contract.doctorId,
          contractId: contract.id,
          date: dto.desiredDate,
          slotWindow: resolvedSlotWindow,
          visitType: dto.encounterType === EncounterType.TELEHEALTH ? 'VIDEO' : 'HOME_VISIT',
          encounterId: encounter.id,
        });
      }

      await session.createAuditLog(actor.id, 'CREATE_ADHOC_ENCOUNTER', encounter.id);

      // Notify attending doctor
      if (contract.doctor?.user?.id) {
        await session.createNotification({
          userId: contract.doctor.user.id,
          title: 'Yêu cầu Tư vấn Video mới từ gia đình',
          content: `Hộ gia đình yêu cầu Tư vấn Video ngày ${dto.desiredDate} (${resolvedSlotWindow === 'MORNING' ? 'Khung Sáng' : 'Khung Chiều'}). Nội dung: ${displayReason}`,
          type: 'ENCOUNTER_ADHOC_REQUESTED',
          referenceId: encounter.id,
        });
      }

      return enrichEncounterWithScheduleMeta(encounter);
    });
  }

  async finalizeEncounter(actor: AuthenticatedUser, encounterId: string, dto: FinalizeEncounterDto) {
    if (!['DOCTOR', 'ADMIN'].includes(actor.role)) {
      throw new ForbiddenException('Only the attending doctor or admin can finalize the examination schedule');
    }

    return this.repository.transaction(async (session) => {
      const encounter = await session.findEncounter(encounterId);
      if (!encounter) throw new NotFoundException('Encounter not found');

      if (actor.role === 'DOCTOR') {
        const doc = await session.findDoctorByUserId(actor.id);
        if (!doc || doc.id !== encounter.doctorId) {
          throw new ForbiddenException('You are not the assigned doctor for this examination');
        }
      }

      const existingMeta = parseEncounterScheduleMeta(encounter);
      const updateData: Prisma.EncounterUncheckedUpdateInput = {
        cancelReason: serializeEncounterScheduleMeta(
          {
            stage: 'AWAITING_FAMILY_CONFIRM',
            ...(existingMeta.milestoneIndex !== null ? { milestoneIndex: existingMeta.milestoneIndex } : {}),
            ...(existingMeta.totalMilestones !== null ? { totalMilestones: existingMeta.totalMilestones } : {}),
          },
          dto.doctorNotes ?? existingMeta.displayNotes,
        ),
      };
      if (dto.encounterType) updateData.encounterType = dto.encounterType;
      if (dto.scheduledDate) updateData.scheduledDate = parseDateOnly(dto.scheduledDate);
      if (dto.scheduledTime) updateData.scheduledTime = parseTimeToDate(dto.scheduledTime);

      const updated = await session.updateEncounter(encounterId, updateData);
      await session.createAuditLog(actor.id, 'FINALIZE_ENCOUNTER_SCHEDULE', encounterId);

      // Notify family to review and confirm
      await session.createNotification({
        userId: encounter.contract.familyUnit.representativeUserId,
        title: 'Lịch khám đã được bác sĩ chốt',
        content: `Bác sĩ đã chốt phương án khám. Vui lòng xác nhận để hoàn tất đồng bộ lịch.`,
        type: 'ENCOUNTER_FINALIZED_BY_DOCTOR',
        referenceId: encounter.id,
      });

      return enrichEncounterWithScheduleMeta(updated);
    });
  }

  async confirmEncounter(actor: AuthenticatedUser, encounterId: string, dto: ConfirmEncounterDto) {
    if (!['FAMILY_REP', 'DOCTOR', 'ADMIN'].includes(actor.role)) {
      throw new ForbiddenException('Only the family representative, attending doctor, or admin can confirm the schedule');
    }

    return this.repository.transaction(async (session) => {
      const encounter = await session.findEncounter(encounterId);
      if (!encounter) throw new NotFoundException('Encounter not found');
      if (encounter.encounterStatus === EncounterStatus.CONFIRMED) {
        throw new ConflictException('Encounter is already confirmed');
      }

      if (actor.role === 'FAMILY_REP' && encounter.contract.familyUnit.representativeUserId !== actor.id) {
        throw new ForbiddenException('You are not authorized to confirm this encounter');
      }
      if (actor.role === 'DOCTOR') {
        const doc = await session.findDoctorByUserId(actor.id);
        if (!doc || doc.id !== encounter.doctorId) {
          throw new ForbiddenException('You are not the assigned doctor for this examination');
        }
      }

      if (!dto.confirmed) {
        if (
          actor.role === 'DOCTOR' &&
          encounter.encounterType === EncounterType.TELEHEALTH &&
          encounter.encounterStatus === EncounterStatus.REQUESTED
        ) {
          const declined = await session.updateEncounter(encounterId, {
            encounterStatus: EncounterStatus.CANCELLED,
          });
          await session.releaseTelehealthQuota(encounter.contractId);
          const declineTx = (session as unknown as { tx?: Prisma.TransactionClient }).tx;
          if (declineTx && this.slotLedger) {
            await this.slotLedger.releaseEncounter(declineTx, encounterId);
          }
          await session.createAuditLog(actor.id, 'DECLINE_TELEHEALTH_ENCOUNTER', encounterId);
          await session.createNotification({
            userId: encounter.contract.familyUnit.representativeUserId,
            title: 'Bác sĩ từ chối lịch Tư vấn Video',
            content: `Bác sĩ chưa thể nhận lịch Tư vấn Video ngày ${encounter.scheduledDate.toISOString().slice(0, 10)}. Lượt tạm giữ đã được hoàn lại.`,
            type: 'ENCOUNTER_CANCELLED',
            referenceId: encounter.id,
          });
          return declined;
        }
        throw new BadRequestException('To propose an alternative time, please use the reschedule endpoint');
      }

      const parsedStage = parseEncounterScheduleMeta(encounter).scheduleStage;
      const isDoctorDirectApprove =
        (actor.role === 'DOCTOR' || actor.role === 'ADMIN') &&
        encounter.encounterType === EncounterType.TELEHEALTH &&
        parsedStage === 'AWAITING_DOCTOR_REVIEW';

      if (parsedStage !== 'AWAITING_FAMILY_CONFIRM' && !isDoctorDirectApprove) {
        throw new BadRequestException(
          parsedStage === 'CADENCE_DRAFT'
            ? 'Bác sĩ chưa hoàn tất rà soát và chốt khung lịch định kỳ này'
            : 'Lịch khám chưa ở trạng thái chờ xác nhận',
        );
      }

      const contractQuota = encounter.contract as unknown as {
        remainingHomeVisits?: number;
        remainingTelehealth?: number;
        servicePackage?: { videoQuotaPolicy?: string | null } | null;
      };
      if (
        encounter.encounterType === EncounterType.HOME_VISIT &&
        typeof contractQuota.remainingHomeVisits === 'number' &&
        contractQuota.remainingHomeVisits <= 0
      ) {
        throw new BadRequestException('Hợp đồng đã hết lượt khám tại nhà còn lại');
      }
      const videoPolicy = contractQuota.servicePackage?.videoQuotaPolicy ?? 'FIXED';
      if (
        encounter.encounterType === EncounterType.TELEHEALTH &&
        videoPolicy === 'FIXED' &&
        typeof contractQuota.remainingTelehealth === 'number' &&
        contractQuota.remainingTelehealth <= 0
      ) {
        throw new BadRequestException('Hợp đồng đã hết lượt tư vấn Telehealth còn lại');
      }

      const resolvedTime = dto.confirmedTime
        ? parseTimeToDate(dto.confirmedTime)
        : encounter.scheduledTime;

      // Check for conflicts with other confirmed/in-progress encounters on the platform
      const conflictResult = await this.checkEncounterSlotConflict(
        session,
        encounter.doctorId,
        encounter.scheduledDate,
        resolvedTime,
        encounter.id,
      );

      if (conflictResult.hasConflict) {
        throw new ConflictException(conflictResult.reason);
      }

      // No conflict -> Save finalized schedule and synchronize across all three parties
      if (encounter.encounterType === EncounterType.TELEHEALTH) {
        await session.commitHeldTelehealthQuota(encounter.contractId);
      } else {
        await session.decrementContractQuota(encounter.contractId, encounter.encounterType);
      }

      const confirmedEncounter = await session.updateEncounter(encounterId, {
        encounterStatus: EncounterStatus.CONFIRMED,
        scheduledTime: resolvedTime,
        confirmedAt: new Date(),
      });

      await session.createAuditLog(actor.id, 'CONFIRM_ENCOUNTER', encounterId);

      // Synchronize notifications across Doctor, Family, and Facility
      const targetDateStr = encounter.scheduledDate.toISOString().slice(0, 10);
      const notifications: Prisma.NotificationUncheckedCreateInput[] = [
        {
          userId: encounter.contract.familyUnit.representativeUserId,
          title: 'Lịch khám đã được xác nhận',
          content: `Lịch khám ngày ${targetDateStr} đã xác nhận thành công. Hệ thống sẽ nhắc bạn trước 24h và 2h.`,
          type: 'ENCOUNTER_CONFIRMED',
          referenceId: encounter.id,
        },
      ];

      if (encounter.doctor.user?.id) {
        const patientLabel =
          encounter.participants.length > 0
            ? encounter.participants.map((p) => p.patient.fullName).join(', ')
            : `hộ gia đình (${encounter.contract.familyUnit.representativeUser.fullName})`;
        notifications.push({
          userId: encounter.doctor.user.id,
          title: 'Gia đình đã xác nhận lịch khám',
          content: `Lịch khám ngày ${targetDateStr} cho ${patientLabel} đã được xác nhận thành công.`,
          type: 'ENCOUNTER_CONFIRMED',
          referenceId: encounter.id,
        });
      }

      if (encounter.encounterType !== EncounterType.TELEHEALTH && encounter.contract.facility.user?.id) {
        notifications.push({
          userId: encounter.contract.facility.userId,
          title: 'Đồng bộ lịch khám gia đình',
          content: `Bác sĩ ${encounter.doctor.doctorName} có lịch khám đã xác nhận vào ngày ${targetDateStr}.`,
          type: 'ENCOUNTER_CONFIRMED',
          referenceId: encounter.id,
        });
      }

      await session.createNotifications(notifications);

      return enrichEncounterWithScheduleMeta(confirmedEncounter);
    });
  }

  async cancelEncounter(actor: AuthenticatedUser, encounterId: string, reason?: string) {
    if (!['FAMILY_REP', 'DOCTOR', 'ADMIN'].includes(actor.role)) {
      throw new ForbiddenException('Bạn không có quyền hủy lịch khám này');
    }

    return this.repository.transaction(async (session) => {
      const encounter = await session.findEncounter(encounterId);
      if (!encounter) throw new NotFoundException('Encounter not found');

      if (actor.role === 'FAMILY_REP' && encounter.contract.familyUnit.representativeUserId !== actor.id) {
        throw new ForbiddenException('You are not authorized to cancel this encounter');
      }
      if (actor.role === 'DOCTOR') {
        const doc = await session.findDoctorByUserId(actor.id);
        if (!doc || doc.id !== encounter.doctorId) {
          throw new ForbiddenException('You are not the assigned doctor for this encounter');
        }
      }

      if (
        encounter.encounterStatus === EncounterStatus.COMPLETED ||
        encounter.encounterStatus === EncounterStatus.CANCELLED
      ) {
        throw new ConflictException('Buổi khám đã hoàn thành hoặc đã hủy trước đó');
      }

      const isTelehealth = encounter.encounterType === EncounterType.TELEHEALTH;
      let refunded = false;

      if (isTelehealth) {
        if (encounter.encounterStatus === EncounterStatus.REQUESTED) {
          await session.releaseTelehealthQuota(encounter.contractId);
          refunded = true;
        } else if (encounter.encounterStatus === EncounterStatus.CONFIRMED) {
          const scheduledMs = combineDateAndTime(
            encounter.scheduledDate,
            encounter.scheduledTime,
          ).getTime();
          const hoursUntil = (scheduledMs - Date.now()) / (60 * 60 * 1000);
          if (actor.role !== 'FAMILY_REP' || hoursUntil >= 2) {
            await session.refundTelehealthQuota(encounter.contractId);
            refunded = true;
          }
        }
      }

      const updated = await session.updateEncounter(encounterId, {
        encounterStatus: EncounterStatus.CANCELLED,
        cancelReason: reason?.trim() || encounter.cancelReason,
      });
      const tx = (session as unknown as { tx?: Prisma.TransactionClient }).tx;
      if (tx && this.slotLedger) {
        await this.slotLedger.releaseEncounter(tx, encounterId);
      }
      await session.createAuditLog(actor.id, 'CANCEL_ENCOUNTER', encounterId);
      return { ...enrichEncounterWithScheduleMeta(updated), refunded };
    });
  }

  private reconcileHomeVisitStatus(
    hasDoctorCompleted: boolean,
    hasFamilyConfirmed: boolean,
  ): EncounterStatus {
    if (hasDoctorCompleted && hasFamilyConfirmed) {
      return EncounterStatus.COMPLETED;
    }
    if (!hasDoctorCompleted && hasFamilyConfirmed) {
      return 'PENDING_RECORD' as EncounterStatus;
    }
    return EncounterStatus.CONFIRMED;
  }

  private hasReachedScheduledStart(scheduledDate: Date, scheduledTime: Date, now: Date): boolean {
    const scheduledStartUtcMs = Date.UTC(
      scheduledDate.getUTCFullYear(),
      scheduledDate.getUTCMonth(),
      scheduledDate.getUTCDate(),
      scheduledTime.getUTCHours() - 7,
      scheduledTime.getUTCMinutes(),
      scheduledTime.getUTCSeconds(),
    );
    return now.getTime() >= scheduledStartUtcMs;
  }

  async confirmArrival(actor: AuthenticatedUser, encounterId: string) {
    if (!['FAMILY_REP', 'ADMIN'].includes(actor.role)) {
      throw new ForbiddenException('Chỉ đại diện gia đình hoặc quản trị viên mới có thể xác nhận bác sĩ đã đến khám.');
    }
    return this.repository.transaction(async (session) => {
      const encounter = await session.findEncounter(encounterId);
      if (!encounter) throw new NotFoundException('Không tìm thấy ca khám.');
      if (
        actor.role === 'FAMILY_REP' &&
        encounter.contract.familyUnit.representativeUserId !== actor.id
      ) {
        throw new ForbiddenException('Bạn không có quyền xác nhận ca khám này.');
      }
      if (encounter.encounterType !== EncounterType.HOME_VISIT) {
        throw new BadRequestException('Chỉ áp dụng xác nhận bác sĩ đến khám cho lịch khám tại nhà.');
      }
      const statusStr = String(encounter.encounterStatus);
      if (statusStr !== 'CONFIRMED') {
        throw new BadRequestException('Ca khám không ở trạng thái có thể xác nhận.');
      }
      const now = new Date();
      if (!this.hasReachedScheduledStart(encounter.scheduledDate, encounter.scheduledTime, now)) {
        throw new BadRequestException('Chưa đến giờ hẹn khám, chưa thể xác nhận.');
      }
      const hasDoctorCompleted = Boolean((encounter as any).doctorCompletedAt);
      const nextStatus = this.reconcileHomeVisitStatus(hasDoctorCompleted, true);
      const updated = await session.updateEncounter(encounter.id, {
        encounterStatus: nextStatus,
        familyConfirmedArrivalAt: now,
      } as Prisma.EncounterUncheckedUpdateInput);
      await session.createAuditLog(actor.id, 'FAMILY_CONFIRMED_ARRIVAL', encounter.id);
      if (encounter.doctor.user?.id) {
        await session.createNotification({
          userId: encounter.doctor.user.id,
          title: 'Gia đình đã xác nhận bác sĩ có mặt',
          content: hasDoctorCompleted
            ? 'Đại diện gia đình đã xác nhận bạn có mặt tại nhà và hồ sơ khám đã hoàn tất.'
            : 'Đại diện gia đình đã xác nhận bạn có mặt tại nhà. Vui lòng hoàn tất ghi bệnh án và đơn thuốc.',
          type: 'ENCOUNTER_ARRIVAL_CONFIRMED',
          referenceId: encounter.id,
        });
      }
      return updated;
    });
  }

  async completeEncounter(
    actor: AuthenticatedUser,
    encounterId: string,
    dto: CompleteEncounterDto,
  ) {
    if (!['DOCTOR', 'ADMIN'].includes(actor.role)) {
      throw new ForbiddenException('Chỉ bác sĩ phụ trách hoặc quản trị viên mới có thể hoàn tất ca khám.');
    }
    return this.repository.transaction(async (session) => {
      const encounter = await session.findEncounter(encounterId);
      if (!encounter) throw new NotFoundException('Không tìm thấy ca khám.');
      if (actor.role === 'DOCTOR') {
        const doc = await session.findDoctorByUserId(actor.id);
        if (!doc || doc.id !== encounter.doctorId) {
          throw new ForbiddenException('Bạn không phải bác sĩ phụ trách ca khám này.');
        }
      }
      if (encounter.encounterType !== EncounterType.HOME_VISIT) {
        throw new BadRequestException('Chỉ áp dụng hoàn tất cấp hộ gia đình cho lịch khám tại nhà.');
      }
      const statusStr = String(encounter.encounterStatus);
      if (['CANCELLED', 'NO_SHOW', 'DISPUTED'].includes(statusStr)) {
        throw new BadRequestException('Ca khám đã bị khóa hoặc hủy, không thể hoàn tất.');
      }

      const pendingParticipants = (encounter.participants ?? []).filter(
        (p: any) => p.attendanceStatus === 'PLANNED',
      );
      if (pendingParticipants.length > 0) {
        throw new BadRequestException({
          code: 'ATTENDANCE_PENDING',
          message: `Còn ${pendingParticipants.length} thành viên chưa điểm danh (khám hoặc vắng).`,
        });
      }

      const examinedParticipants = (encounter.participants ?? []).filter(
        (p: any) => p.attendanceStatus === 'EXAMINED',
      );
      if (examinedParticipants.length === 0) {
        throw new BadRequestException('Cần ít nhất 1 thành viên được khám và chốt hồ sơ trước khi hoàn tất ca khám.');
      }
      const finalizedPatientIds = new Set(
        (encounter.clinicalEmrs ?? [])
          .filter((emr: any) => emr.isFinalized)
          .map((emr: any) => emr.patientId),
      );
      const missingFinalized = examinedParticipants.some(
        (p: any) => !finalizedPatientIds.has(p.patientId),
      );
      if (missingFinalized) {
        throw new BadRequestException('Vẫn còn thành viên tham gia khám chưa được chốt hồ sơ.');
      }

      const now = new Date();
      const deadlines = computeHomeVisitDeadlines({
        scheduledDate: encounter.scheduledDate,
        scheduledTime: encounter.scheduledTime,
        slotWindow: encounter.slotWindow,
      });
      const overdue =
        isRecordOverdue(deadlines, now) || Boolean((encounter as any).recordOverdueAt);
      const trimmedReason = dto?.lateCompletionReason?.trim() || '';
      if (overdue && !trimmedReason) {
        throw new BadRequestException('Vui lòng nhập lý do nộp hồ sơ trễ.');
      }

      const hasFamilyConfirmed = Boolean(encounter.familyConfirmedArrivalAt);
      const nextStatus = this.reconcileHomeVisitStatus(true, hasFamilyConfirmed);

      const updateData: Record<string, unknown> = {
        doctorCompletedAt: now,
        encounterStatus: nextStatus,
      };
      if (overdue) {
        updateData.lateCompletionReason = trimmedReason;
        updateData.recordOverdueAt = (encounter as any).recordOverdueAt ?? now;
      }

      const updated = await session.updateEncounter(
        encounter.id,
        updateData as Prisma.EncounterUncheckedUpdateInput,
      );

      await session.createAuditLog(
        actor.id,
        'COMPLETE_HOME_VISIT_ENCOUNTER',
        encounter.id,
      );

      await session.createNotification({
        userId: encounter.contract.familyUnit.representativeUserId,
        title: hasFamilyConfirmed
          ? 'Buổi khám đã hoàn tất'
          : 'Bác sĩ đã hoàn tất buổi khám',
        content: hasFamilyConfirmed
          ? 'Bác sĩ đã hoàn tất toàn bộ buổi khám và bệnh án. Bạn có thể xem lại sổ khám và gửi đánh giá bác sĩ.'
          : 'Bác sĩ đã hoàn tất buổi khám và gửi bệnh án. Vui lòng xác nhận 1 chạm trong vòng 48 giờ để hoàn tất hồ sơ.',
        type: 'ENCOUNTER_COMPLETED',
        referenceId: encounter.id,
      });

      return updated;
    });
  }

  async updateParticipantAttendance(
    actor: AuthenticatedUser,
    encounterId: string,
    patientId: string,
    dto: UpdateParticipantAttendanceDto,
  ) {
    if (!['DOCTOR', 'ADMIN'].includes(actor.role)) {
      throw new ForbiddenException('Chỉ bác sĩ phụ trách hoặc quản trị viên mới có thể cập nhật trạng thái tham gia.');
    }
    return this.repository.transaction(async (session) => {
      const encounter = await session.findEncounter(encounterId);
      if (!encounter) throw new NotFoundException('Không tìm thấy ca khám.');
      if (actor.role === 'DOCTOR') {
        const doc = await session.findDoctorByUserId(actor.id);
        if (!doc || doc.id !== encounter.doctorId) {
          throw new ForbiddenException('Bạn không phải bác sĩ phụ trách ca khám này.');
        }
      }
      if (
        ['DISPUTED', 'NO_SHOW', 'CANCELLED', 'COMPLETED'].includes(
          String(encounter.encounterStatus),
        )
      ) {
        throw new ConflictException(
          'Ca khám đã kết thúc hoặc bị khóa, không thể đổi điểm danh.',
        );
      }
      const existingEmr = (encounter.clinicalEmrs ?? []).find(
        (emr: any) => emr.patientId === patientId,
      );
      if (existingEmr?.isFinalized) {
        throw new ConflictException('Thành viên đã chốt hồ sơ khám, không thể thay đổi trạng thái tham gia.');
      }
      if (typeof session.upsertParticipantAttendance !== 'function') {
        throw new BadRequestException('Không hỗ trợ cập nhật trạng thái tham gia.');
      }
      const absenceReason =
        dto.attendanceStatus === 'ABSENT'
          ? (dto.absenceReason?.trim() ?? null)
          : null;
      return session.upsertParticipantAttendance(
        encounterId,
        patientId,
        dto.attendanceStatus,
        absenceReason,
      );
    });
  }

  async requestReschedule(actor: AuthenticatedUser, encounterId: string, dto: RequestRescheduleDto) {
    if (!['FAMILY_REP', 'DOCTOR', 'HEALTHCARE_FACILITY', 'ADMIN'].includes(actor.role)) {
      throw new ForbiddenException(
        'Only family representative, assigned doctor, healthcare facility, or admin can request reschedule',
      );
    }

    return this.repository.transaction(async (session) => {
      const encounter = await session.findEncounter(encounterId);
      if (!encounter) throw new NotFoundException('Encounter not found');

      if (encounter.encounterStatus !== EncounterStatus.CONFIRMED) {
        throw new BadRequestException('Only CONFIRMED encounters can be rescheduled');
      }

      if (actor.role === 'FAMILY_REP' && encounter.contract.familyUnit.representativeUserId !== actor.id) {
        throw new ForbiddenException('You are not authorized to reschedule this encounter');
      }
      if (actor.role === 'DOCTOR') {
        const doc = await session.findDoctorByUserId(actor.id);
        if (!doc || doc.id !== encounter.doctorId) {
          throw new ForbiddenException('You are not the assigned doctor for this encounter');
        }
      }
      if (actor.role === 'HEALTHCARE_FACILITY') {
        const fac = await session.findFacilityByUserId(actor.id);
        if (!fac || fac.id !== encounter.contract.facilityId) {
          throw new ForbiddenException('You are not the facility for this encounter');
        }
      }

      const tx = (session as unknown as { tx?: Prisma.TransactionClient }).tx;
      if (tx) {
        await this.expireStaleRescheduleRequests(tx);
        if (typeof (tx as { $executeRaw?: unknown }).$executeRaw === 'function') {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${encounter.doctorId}))`;
        }
      }

      // BR-4: Không giới hạn tổng số lần đổi lịch
      const existingPending = await session.findPendingRescheduleRequestByEncounter(encounterId);
      if (existingPending) {
        throw new ConflictException('Buổi khám này đang có 1 yêu cầu đổi lịch chờ phản hồi');
      }

      // BR-1: Báo trước ít nhất 1 ngày (trước 20:00 tối hôm trước ngày khám cũ theo giờ VN UTC+7)
      const now = new Date();
      const deadlineUtc = new Date(
        Date.UTC(
          encounter.scheduledDate.getUTCFullYear(),
          encounter.scheduledDate.getUTCMonth(),
          encounter.scheduledDate.getUTCDate() - 1,
          13, // 20:00 UTC+7 = 13:00 UTC
          0,
          0,
          0,
        ),
      );

      if (now.getTime() > deadlineUtc.getTime()) {
        await session.createAuditLog(actor.id, 'RESCHEDULE_REJECTED_PAST_DEADLINE', encounterId);
        await session.createNotification({
          userId: actor.id,
          title: 'Yêu cầu đổi lịch bị từ chối do quá thời hạn báo trước',
          content:
            'Yêu cầu đổi lịch phải được gửi trước 20:00 tối hôm trước ngày khám. Vui lòng liên hệ Hotline hỗ trợ nếu có việc khẩn cấp.',
          type: 'RESCHEDULE_REJECTED_UNDER_4H',
          referenceId: encounter.id,
        });

        throw new BadRequestException(
          'Yêu cầu đổi lịch phải được gửi trước 20:00 tối hôm trước ngày khám cũ.',
        );
      }

      const proposedDate = parseDateOnly(dto.proposedDate);
      const proposedTime = parseTimeToDate(dto.proposedTime);

      // BR-1 áp dụng cho cả ngày mới: Không cho chọn quá khứ, không cho chọn hôm nay, và sau 20:00 không cho chọn ngày mai
      const proposedDeadlineUtc = new Date(
        Date.UTC(
          proposedDate.getUTCFullYear(),
          proposedDate.getUTCMonth(),
          proposedDate.getUTCDate() - 1,
          13, // 20:00 UTC+7 = 13:00 UTC
          0,
          0,
          0,
        ),
      );
      if (now.getTime() > proposedDeadlineUtc.getTime()) {
        throw new BadRequestException(
          'Không thể đổi lịch vào ngày hôm nay hoặc quá khứ (ngày mới phải đặt trước 20:00 tối hôm trước).',
        );
      }
      const dayOff = isDayOffDate(proposedDate);
      if (dayOff.isDayOff) {
        throw new BadRequestException(dayOff.reason || 'Ngày đã chọn là ngày nghỉ');
      }

      const contractStart = encounter.contract?.startDate
        ? new Date(
            Date.UTC(
              encounter.contract.startDate.getUTCFullYear(),
              encounter.contract.startDate.getUTCMonth(),
              encounter.contract.startDate.getUTCDate(),
              0,
              0,
              0,
              0,
            ),
          )
        : null;
      const contractEnd = encounter.contract?.endDate
        ? new Date(
            Date.UTC(
              encounter.contract.endDate.getUTCFullYear(),
              encounter.contract.endDate.getUTCMonth(),
              encounter.contract.endDate.getUTCDate(),
              0,
              0,
              0,
              0,
            ),
          )
        : null;

      if (contractStart && proposedDate.getTime() < contractStart.getTime()) {
        throw new BadRequestException(
          'Ngày đề xuất đổi lịch nằm trước ngày bắt đầu hiệu lực của hợp đồng.',
        );
      }
      if (contractEnd && proposedDate.getTime() >= contractEnd.getTime()) {
        throw new BadRequestException(
          'Ngày đề xuất đổi lịch vượt quá thời hạn hiệu lực của gói chăm sóc.',
        );
      }

      const targetSlot = mapTimeToSlotWindow(proposedTime);
      if (tx && this.slotLedger) {
        const occupied = await this.slotLedger.listOccupied(
          tx,
          encounter.doctorId,
          dto.proposedDate,
          dto.proposedDate,
          { excludeContractId: encounter.contractId },
        );
        if (occupied.some((s) => s.slotWindow === targetSlot)) {
          throw new ConflictException({
            code: 'SLOT_TAKEN',
            message: 'Ca này vừa có người đặt, vui lòng chọn ca khác',
            date: dto.proposedDate,
            slotWindow: targetSlot,
          });
        }
      }

      const isHomeVisit = encounter.encounterType === EncounterType.HOME_VISIT;
      if (isHomeVisit && tx) {
        // BR-2 (Soft-lock) & BR-5 (Cho phép đổi khung trong cùng 1 ngày bằng cách loại trừ encounter.id)
        const [dayEncounters, pendingSoftLocks] = await Promise.all([
          tx.encounter.findMany({
            where: {
              doctorId: encounter.doctorId,
              scheduledDate: proposedDate,
              id: { not: encounter.id },
              encounterStatus: {
                in: [
                  EncounterStatus.CONFIRMED,
                  EncounterStatus.ON_THE_WAY,
                  EncounterStatus.ARRIVED,
                  EncounterStatus.IN_PROGRESS,
                ],
              },
            },
            select: {
              encounterType: true,
              scheduledTime: true,
              contract: { select: { familyId: true } },
            },
          }),
          tx.encounterRescheduleRequest.findMany({
            where: {
              status: 'PENDING',
              proposedDate,
              encounter: { doctorId: encounter.doctorId, id: { not: encounter.id } },
            },
            select: {
              proposedTime: true,
              encounter: { select: { encounterType: true } },
            },
          }),
        ]);

        const contractInfo = await tx.medicalContract.findUnique({
          where: { id: encounter.contractId },
          select: { familyId: true },
        });
        if (
          contractInfo?.familyId &&
          dayEncounters.some((e) => e.contract?.familyId === contractInfo.familyId)
        ) {
          throw new ConflictException(
            'Gia đình đã có 1 lượt khám khác trong ngày này (quy tắc tối đa 1 lượt/ngày)',
          );
        }

        if (!this.slotLedger) {
          const combinedSlots: SlotEncounterSummary[] = [
            ...dayEncounters.map((e) => ({
              encounterType: e.encounterType,
              scheduledTime: e.scheduledTime,
            })),
            ...pendingSoftLocks.map((r) => ({
              encounterType: r.encounter.encounterType,
              scheduledTime: r.proposedTime,
            })),
          ];

          const slotCheck = evaluateSlotWindowAvailability(targetSlot, combinedSlots);
          if (!slotCheck.available) {
            throw new ConflictException(
              slotCheck.reason || 'Khung giờ này Bác sĩ đã kín hoặc đang được tạm giữ chờ xác nhận',
            );
          }
        }
      } else if (!this.slotLedger) {
        const conflict = await this.checkEncounterSlotConflict(
          session,
          encounter.doctorId,
          proposedDate,
          proposedTime,
          encounter.id,
        );
        if (conflict.hasConflict) {
          throw new ConflictException(conflict.reason);
        }
      }

      const isTelehealth = encounter.encounterType === EncounterType.TELEHEALTH;
      const requestedByRole =
        actor.role === 'DOCTOR'
          ? 'DOCTOR'
          : actor.role === 'HEALTHCARE_FACILITY'
            ? 'HEALTHCARE_FACILITY'
            : 'FAMILY_REP';
      const request = await session.createRescheduleRequest({
        encounterId: encounter.id,
        requestedByRole,
        requestedByUserId: actor.id,
        proposedDate,
        proposedTime,
        reason: dto.rescheduleReason,
        familyDecision:
          requestedByRole === 'FAMILY_REP'
            ? RescheduleDecision.APPROVED
            : RescheduleDecision.PENDING,
        familyDecidedBy: requestedByRole === 'FAMILY_REP' ? actor.id : null,
        familyDecidedAt: requestedByRole === 'FAMILY_REP' ? now : null,
        doctorDecision:
          requestedByRole === 'DOCTOR' || requestedByRole === 'HEALTHCARE_FACILITY'
            ? RescheduleDecision.APPROVED
            : RescheduleDecision.PENDING,
        doctorDecidedBy:
          requestedByRole === 'DOCTOR' || requestedByRole === 'HEALTHCARE_FACILITY'
            ? actor.id
            : null,
        doctorDecidedAt:
          requestedByRole === 'DOCTOR' || requestedByRole === 'HEALTHCARE_FACILITY' ? now : null,
        facilityDecision:
          requestedByRole === 'HEALTHCARE_FACILITY' || isTelehealth
            ? RescheduleDecision.APPROVED
            : RescheduleDecision.PENDING,
        facilityDecidedBy: requestedByRole === 'HEALTHCARE_FACILITY' ? actor.id : null,
        facilityDecidedAt: requestedByRole === 'HEALTHCARE_FACILITY' || isTelehealth ? now : null,
        status: 'PENDING',
      });

      await session.createAuditLog(actor.id, 'REQUEST_RESCHEDULE', request.id);

      const notifications: Prisma.NotificationUncheckedCreateInput[] = [];
      if (requestedByRole === 'FAMILY_REP') {
        if (encounter.doctor.user?.id) {
          notifications.push({
            userId: encounter.doctor.user.id,
            title: 'Gia đình yêu cầu đổi lịch khám',
            content: `Gia đình đề xuất đổi sang ngày ${dto.proposedDate} lúc ${dto.proposedTime}. Lý do: ${dto.rescheduleReason}`,
            type: 'ENCOUNTER_RESCHEDULE_REQUESTED',
            referenceId: encounter.id,
          });
        }
      } else {
        notifications.push({
          userId: encounter.contract.familyUnit.representativeUserId,
          title:
            requestedByRole === 'HEALTHCARE_FACILITY'
              ? 'Cơ sở y tế đề xuất đổi lịch khám'
              : 'Bác sĩ yêu cầu đổi lịch khám',
          content: `${requestedByRole === 'HEALTHCARE_FACILITY' ? 'Cơ sở y tế' : 'Bác sĩ'} đề xuất đổi sang ngày ${dto.proposedDate} lúc ${dto.proposedTime}. Lý do: ${dto.rescheduleReason}`,
          type: 'ENCOUNTER_RESCHEDULE_REQUESTED',
          referenceId: encounter.id,
        });
      }

      if (!isTelehealth && requestedByRole !== 'HEALTHCARE_FACILITY' && encounter.contract.facility.user?.id) {
        notifications.push({
          userId: encounter.contract.facility.user.id,
          title: 'Thông báo đồng bộ: Có yêu cầu đổi lịch khám mới',
          content: `${requestedByRole === 'FAMILY_REP' ? 'Gia đình' : 'Bác sĩ'} vừa đề xuất đổi lịch khám sang ngày ${dto.proposedDate} lúc ${dto.proposedTime} (đang chờ bên còn lại xác nhận).`,
          type: 'ENCOUNTER_RESCHEDULE_REQUESTED',
          referenceId: encounter.id,
        });
      }

      await session.createNotifications(notifications);
      return request;
    });
  }

  async decideRescheduleRequest(
    actor: AuthenticatedUser,
    encounterId: string,
    requestId: string,
    dto: DecideRescheduleRequestDto,
  ) {
    if (actor.role === 'HEALTHCARE_FACILITY') {
      throw new ForbiddenException(
        'Reschedule decisions are handled directly between doctor and family; healthcare facilities monitor synchronized updates.',
      );
    }
    if (!['FAMILY_REP', 'DOCTOR', 'ADMIN'].includes(actor.role)) {
      throw new ForbiddenException('You are not authorized to review reschedule requests');
    }

    return this.repository.transaction(async (session) => {
      const tx = (session as unknown as { tx?: Prisma.TransactionClient }).tx;
      if (tx) {
        await this.expireStaleRescheduleRequests(tx);
      }

      const encounter = await session.findEncounter(encounterId);
      if (!encounter) throw new NotFoundException('Encounter not found');

      const request = await session.findRescheduleRequestById(requestId);
      if (!request || request.encounterId !== encounterId) {
        throw new NotFoundException('Reschedule request not found');
      }
      if (request.status !== 'PENDING') {
        throw new ConflictException(
          'Yêu cầu đổi lịch đã được xử lý hoặc đã tự động hết hạn sau 24 giờ',
        );
      }

      if (actor.role === 'FAMILY_REP' && encounter.contract.familyUnit.representativeUserId !== actor.id) {
        throw new ForbiddenException('You are not authorized to decide this reschedule request');
      }
      if (actor.role === 'DOCTOR') {
        const doc = await session.findDoctorByUserId(actor.id);
        if (!doc || doc.id !== encounter.doctorId) {
          throw new ForbiddenException('You are not the assigned doctor for this encounter');
        }
      }

      const now = new Date();
      const decisionEnum = dto.decision === 'APPROVE' ? RescheduleDecision.APPROVED : RescheduleDecision.REJECTED;
      const updateData: Prisma.EncounterRescheduleRequestUncheckedUpdateInput = {};

      if (actor.role === 'FAMILY_REP') {
        if (request.familyDecision !== RescheduleDecision.PENDING) {
          throw new ConflictException('Family decision has already been recorded');
        }
        updateData.familyDecision = decisionEnum;
        updateData.familyDecidedBy = actor.id;
        updateData.familyDecidedAt = now;
        updateData.familyNote = dto.note ?? null;
      } else if (actor.role === 'DOCTOR') {
        if (request.doctorDecision !== RescheduleDecision.PENDING) {
          throw new ConflictException('Doctor decision has already been recorded');
        }
        updateData.doctorDecision = decisionEnum;
        updateData.doctorDecidedBy = actor.id;
        updateData.doctorDecidedAt = now;
        updateData.doctorNote = dto.note ?? null;
      } else {
        // ADMIN override: resolve pending side(s)
        if (request.familyDecision === RescheduleDecision.PENDING) {
          updateData.familyDecision = decisionEnum;
          updateData.familyDecidedBy = actor.id;
          updateData.familyDecidedAt = now;
          updateData.familyNote = dto.note ?? null;
        }
        if (request.doctorDecision === RescheduleDecision.PENDING) {
          updateData.doctorDecision = decisionEnum;
          updateData.doctorDecidedBy = actor.id;
          updateData.doctorDecidedAt = now;
          updateData.doctorNote = dto.note ?? null;
        }
      }

      if (dto.decision === 'REJECT') {
        updateData.status = 'REJECTED';
        updateData.resolvedAt = now;
        const rejected = await session.updateRescheduleRequest(request.id, updateData);
        await session.createAuditLog(actor.id, 'REJECT_RESCHEDULE_REQUEST', request.id);

        const notifications: Prisma.NotificationUncheckedCreateInput[] = [
          {
            userId: encounter.contract.familyUnit.representativeUserId,
            title: 'Yêu cầu đổi lịch đã bị từ chối',
            content: `Yêu cầu đổi lịch không được chấp thuận. Lịch khám cũ vẫn được giữ nguyên.`,
            type: 'ENCOUNTER_RESCHEDULE_REJECTED',
            referenceId: encounter.id,
          },
        ];
        if (encounter.doctor.user?.id) {
          notifications.push({
            userId: encounter.doctor.user.id,
            title: 'Yêu cầu đổi lịch đã bị từ chối',
            content: `Yêu cầu đổi lịch không được chấp thuận. Lịch khám cũ vẫn được giữ nguyên.`,
            type: 'ENCOUNTER_RESCHEDULE_REJECTED',
            referenceId: encounter.id,
          });
        }
        if (encounter.contract.facility.user?.id) {
          notifications.push({
            userId: encounter.contract.facility.user.id,
            title: 'Thông báo đồng bộ: Yêu cầu đổi lịch bị từ chối',
            content: `Yêu cầu đổi lịch khám của ${encounter.doctor.doctorName} không được chấp thuận. Lịch khám cũ vẫn được giữ nguyên.`,
            type: 'ENCOUNTER_RESCHEDULE_REJECTED',
            referenceId: encounter.id,
          });
        }
        await session.createNotifications(notifications);
        return rejected;
      }

      const nextFamily = (updateData.familyDecision as RescheduleDecision | undefined) ?? request.familyDecision;
      const nextDoctor = (updateData.doctorDecision as RescheduleDecision | undefined) ?? request.doctorDecision;

      const bilateralApproved =
        nextFamily === RescheduleDecision.APPROVED &&
        nextDoctor === RescheduleDecision.APPROVED;

      if (!bilateralApproved) {
        const partial = await session.updateRescheduleRequest(request.id, updateData);
        await session.createAuditLog(actor.id, 'PARTIAL_APPROVE_RESCHEDULE', request.id);
        return partial;
      }

      const targetSlotWindow = mapTimeToSlotWindow(request.proposedTime);
      if (tx && this.slotLedger) {
        await this.slotLedger.move(tx, encounter.id, {
          date: request.proposedDate.toISOString().slice(0, 10),
          slotWindow: targetSlotWindow,
        });
      } else {
        // Both Family & Doctor agreed -> Verify slot is still free on platform
        const conflict = await this.checkEncounterSlotConflict(
          session,
          encounter.doctorId,
          request.proposedDate,
          request.proposedTime,
          encounter.id,
        );
        if (conflict.hasConflict) {
          throw new ConflictException(conflict.reason);
        }
      }

      await session.updateEncounter(encounter.id, {
        scheduledDate: request.proposedDate,
        scheduledTime: request.proposedTime,
        slotWindow: targetSlotWindow,
        rescheduleCount: { increment: 1 },
        reminder24hSentAt: null,
        reminder2hSentAt: null,
      });

      updateData.facilityDecision = RescheduleDecision.APPROVED;
      updateData.status = 'APPROVED';
      updateData.resolvedAt = now;
      const approved = await session.updateRescheduleRequest(request.id, updateData);
      await session.createAuditLog(actor.id, 'APPROVE_RESCHEDULE_REQUEST', request.id);

      const newDateStr = request.proposedDate.toISOString().slice(0, 10);
      const newTimeStr = request.proposedTime.toISOString().slice(11, 16);
      const notifications: Prisma.NotificationUncheckedCreateInput[] = [
        {
          userId: encounter.contract.familyUnit.representativeUserId,
          title: 'Đổi lịch khám thành công',
          content: `Lịch khám đã được cập nhật sang ${newTimeStr} ngày ${newDateStr}.`,
          type: 'ENCOUNTER_RESCHEDULE_APPROVED',
          referenceId: encounter.id,
        },
      ];
      if (encounter.doctor.user?.id) {
        notifications.push({
          userId: encounter.doctor.user.id,
          title: 'Đổi lịch khám thành công',
          content: `Lịch khám đã được cập nhật sang ${newTimeStr} ngày ${newDateStr}.`,
          type: 'ENCOUNTER_RESCHEDULE_APPROVED',
          referenceId: encounter.id,
        });
      }
      if (encounter.contract.facility.user?.id) {
        notifications.push({
          userId: encounter.contract.facility.user.id,
          title: 'Đồng bộ lịch khám: Đã đổi giờ thành công',
          content: `Lịch khám của ${encounter.doctor.doctorName} đã được Gia đình và Bác sĩ thống nhất chuyển sang ${newTimeStr} ngày ${newDateStr}.`,
          type: 'ENCOUNTER_RESCHEDULE_APPROVED',
          referenceId: encounter.id,
        });
      }
      await session.createNotifications(notifications);
      return approved;
    });
  }

  async getPendingRescheduleRequests(actor: AuthenticatedUser) {
    return this.repository.transaction(async (session) => {
      const tx = (session as unknown as { tx?: Prisma.TransactionClient }).tx;
      if (tx) {
        await this.expireStaleRescheduleRequests(tx);
      }
      if (actor.role === 'FAMILY_REP') {
        return session.findPendingRescheduleRequests({
          encounter: { contract: { familyUnit: { representativeUserId: actor.id } } },
        });
      }
      if (actor.role === 'DOCTOR') {
        const doc = await session.findDoctorByUserId(actor.id);
        if (!doc) throw new NotFoundException('Doctor profile not found');
        return session.findPendingRescheduleRequests({
          encounter: { doctorId: doc.id },
        });
      }
      if (actor.role === 'HEALTHCARE_FACILITY') {
        const fac = await session.findFacilityByUserId(actor.id);
        if (!fac) throw new NotFoundException('Facility profile not found');
        return session.findPendingRescheduleRequests({
          encounter: { contract: { facilityId: fac.id } },
        });
      }
      return session.findPendingRescheduleRequests({});
    });
  }

  async getDoctorTimetable(actor: AuthenticatedUser, query: ListEncountersQueryDto) {
    if (!['DOCTOR', 'ADMIN'].includes(actor.role)) {
      throw new ForbiddenException('Only doctors or admin can access doctor timetable');
    }

    return this.repository.transaction(async (session) => {
      let doctorId: string | undefined;
      if (actor.role === 'DOCTOR') {
        const doc = await session.findDoctorByUserId(actor.id);
        if (!doc) throw new NotFoundException('Doctor profile not found');
        doctorId = doc.id;
      }

      const where: Prisma.EncounterWhereInput = {
        ...(doctorId ? { doctorId } : {}),
        ...(query.contractId ? { contractId: query.contractId } : {}),
        ...(query.status ? { encounterStatus: query.status } : {}),
        ...(query.category ? { category: query.category } : {}),
        ...(query.encounterType ? { encounterType: query.encounterType } : {}),
        ...(query.fromDate || query.toDate
          ? {
              scheduledDate: {
                ...(query.fromDate ? { gte: parseDateOnly(query.fromDate) } : {}),
                ...(query.toDate ? { lte: parseDateOnly(query.toDate) } : {}),
              },
            }
          : {}),
      };

      const skip = ((query.page ?? 1) - 1) * (query.pageSize ?? 20);
      const take = query.pageSize ?? 20;

      const [items, total] = await session.findEncounters(where, skip, take);
      return {
        data: items.map(enrichEncounterWithScheduleMeta),
        pagination: {
          page: query.page ?? 1,
          pageSize: query.pageSize ?? 20,
          totalItems: total,
          totalPages: Math.ceil(total / (query.pageSize ?? 20)),
        },
      };
    });
  }

  async getFamilyTimetable(actor: AuthenticatedUser, query: ListEncountersQueryDto) {
    if (!['FAMILY_REP', 'ADMIN'].includes(actor.role)) {
      throw new ForbiddenException('Only family representatives or admin can access family timetable');
    }

    return this.repository.transaction(async (session) => {
      const where: Prisma.EncounterWhereInput = {
        ...(actor.role === 'FAMILY_REP'
          ? { contract: { familyUnit: { representativeUserId: actor.id } } }
          : {}),
        ...(query.contractId ? { contractId: query.contractId } : {}),
        ...(query.status ? { encounterStatus: query.status } : {}),
        ...(query.category ? { category: query.category } : {}),
        ...(query.encounterType ? { encounterType: query.encounterType } : {}),
        ...(query.fromDate || query.toDate
          ? {
              scheduledDate: {
                ...(query.fromDate ? { gte: parseDateOnly(query.fromDate) } : {}),
                ...(query.toDate ? { lte: parseDateOnly(query.toDate) } : {}),
              },
            }
          : {}),
      };

      const skip = ((query.page ?? 1) - 1) * (query.pageSize ?? 20);
      const take = query.pageSize ?? 20;

      const [items, total] = await session.findEncounters(where, skip, take);
      return {
        data: items.map(enrichEncounterWithScheduleMeta),
        pagination: {
          page: query.page ?? 1,
          pageSize: query.pageSize ?? 20,
          totalItems: total,
          totalPages: Math.ceil(total / (query.pageSize ?? 20)),
        },
      };
    });
  }

  async getFacilityScheduleBoard(actor: AuthenticatedUser, fromDate?: string, toDate?: string) {
    if (!['HEALTHCARE_FACILITY', 'ADMIN'].includes(actor.role)) {
      throw new ForbiddenException('Only healthcare facility or admin can access facility schedule board');
    }

    return this.repository.transaction(async (session) => {
      let facilityId: string;
      if (actor.role === 'HEALTHCARE_FACILITY') {
        const fac = await session.findFacilityByUserId(actor.id);
        if (!fac) throw new NotFoundException('Facility profile not found');
        facilityId = fac.id;
      } else {
        throw new BadRequestException('Admin must specify facilityId context');
      }

      const fDate = fromDate ? parseDateOnly(fromDate) : undefined;
      const tDate = toDate ? parseDateOnly(toDate) : undefined;

      const [encounters, pendingRescheduleRequests] = await Promise.all([
        session.findEncounters({
          doctor: { facilityId },
          ...(fDate || tDate
            ? {
                scheduledDate: {
                  ...(fDate ? { gte: fDate } : {}),
                  ...(tDate ? { lte: tDate } : {}),
                },
              }
            : {}),
        }, 0, 100),
        session.findPendingRescheduleRequests({
          encounter: { contract: { facilityId } },
        }),
      ]);

      return {
        facilityId,
        encounters: encounters[0].map(enrichEncounterWithScheduleMeta),
        pendingRescheduleRequests,
      };
    });
  }

  async getEncounterDetail(actor: AuthenticatedUser, encounterId: string) {
    return this.repository.transaction(async (session) => {
      const encounter = await session.findEncounter(encounterId);
      if (!encounter) throw new NotFoundException('Encounter not found');

      // Authorization check
      if (actor.role === 'FAMILY_REP' && encounter.contract.familyUnit.representativeUserId !== actor.id) {
        throw new ForbiddenException('You are not authorized to view this encounter');
      }
      if (actor.role === 'DOCTOR') {
        const doc = await session.findDoctorByUserId(actor.id);
        if (!doc || doc.id !== encounter.doctorId) {
          throw new ForbiddenException('You are not authorized to view this encounter');
        }
      }
      if (actor.role === 'HEALTHCARE_FACILITY') {
        const fac = await session.findFacilityByUserId(actor.id);
        if (!fac || fac.id !== encounter.contract.facilityId) {
          throw new ForbiddenException('You are not authorized to view this encounter');
        }
      }

      if (
        Array.isArray(encounter.contract.members) &&
        encounter.contract.members.length === 0 &&
        session.ensureContractDefaultMembers
      ) {
        try {
          const representativeFullName =
            encounter.contract.familyUnit?.representativeUser?.fullName ?? 'Chủ hộ';
          encounter.contract.members = await session.ensureContractDefaultMembers(
            encounter.contract.id,
            encounter.contract.familyId,
            representativeFullName,
          );
        } catch (error) {
          const prismaCode = (error as { code?: string } | null)?.code;
          if (prismaCode !== 'P2034' && prismaCode !== 'P2002') {
            throw error;
          }
        }
      }

      return enrichEncounterWithScheduleMeta(encounter);
    });
  }

  // Conflict Checking Engine between Platform Encounters of the same doctor
  private async checkEncounterSlotConflict(
    session: EncountersSession,
    doctorId: string,
    scheduledDate: Date,
    scheduledTime: Date,
    excludeEncounterId?: string,
    statuses: EncounterStatus[] = [EncounterStatus.CONFIRMED, EncounterStatus.IN_PROGRESS],
  ): Promise<{ hasConflict: boolean; reason?: string }> {
    const encStartMin = getTimeWindowMinutes(scheduledTime);
    const encEndMin = encStartMin + APPOINTMENT_DURATION_MINUTES;

    const otherEncounters = await session.findDoctorOverlappingEncounters(
      doctorId,
      scheduledDate,
      excludeEncounterId,
      statuses,
    );

    for (const other of otherEncounters) {
      const otherStartMin = getTimeWindowMinutes(other.scheduledTime);
      const otherEndMin = otherStartMin + APPOINTMENT_DURATION_MINUTES;

      if (encStartMin < otherEndMin && encEndMin > otherStartMin) {
        return {
          hasConflict: true,
          reason: `Trùng với một lịch khám khác của bác sĩ lúc ${other.scheduledTime.toISOString().slice(11, 16)}`,
        };
      }
    }

    return { hasConflict: false };
  }

  async generateContractPeriodicCadence(
    contractId: string,
    options?: { triggeredBy?: string; force?: boolean },
  ): Promise<{ generatedCount: number; encounters: unknown[] }> {
    return this.repository.transaction(async (session) => {
      const contract = await session.findContract(contractId);
      if (!contract) {
        throw new NotFoundException(`Medical contract ${contractId} not found`);
      }
      if (contract.contractStatus !== 'ACTIVE') {
        throw new BadRequestException('Contract is not active for cadence generation');
      }

      const defaultType =
        contract.remainingHomeVisits > 0
          ? EncounterType.HOME_VISIT
          : contract.remainingTelehealth > 0
            ? EncounterType.TELEHEALTH
            : EncounterType.HOME_VISIT;
      const packageQuota = contract.servicePackage?.periodicVisitsQuota ?? 0;
      const quota =
        packageQuota > 0
          ? packageQuota
          : defaultType === EncounterType.HOME_VISIT
            ? contract.remainingHomeVisits
            : contract.remainingTelehealth;
      const durationMonths = contract.servicePackage?.durationMonths ?? 12;
      if (quota <= 0) {
        return { generatedCount: 0, encounters: [] };
      }

      // Check existing non-cancelled periodic encounters for idempotency
      const [existing] = await session.findEncounters({
        contractId,
        category: EncounterCategory.PERIODIC_ROUTINE,
        encounterStatus: { not: EncounterStatus.CANCELLED },
      });

      if (existing.length > 0 && !options?.force) {
        return { generatedCount: 0, encounters: existing.map(enrichEncounterWithScheduleMeta) };
      }

      if (!contract.doctorId) {
        throw new BadRequestException('Contract has no assigned doctor for scheduling');
      }

      const milestoneDates = calculateCadenceDates(
        contract.startDate,
        durationMonths,
        quota,
        contract.endDate ?? undefined,
      );
      const createdList = [];
      const bookedByDay = new Map<string, number[]>();

      for (let i = 0; i < milestoneDates.length; i++) {
        const targetDate = milestoneDates[i];
        const dayKey = targetDate.toISOString().slice(0, 10);
        const bookedMinutes = bookedByDay.get(dayKey) ?? [];
        let chosenTime = parseTimeToDate(CADENCE_CANDIDATE_SLOTS[0]);

        for (const slot of CADENCE_CANDIDATE_SLOTS) {
          const candidateTime = parseTimeToDate(slot);
          const candidateMin = getTimeWindowMinutes(candidateTime);
          const overlapsLocal = bookedMinutes.some(
            (m) => candidateMin < m + APPOINTMENT_DURATION_MINUTES && candidateMin + APPOINTMENT_DURATION_MINUTES > m,
          );
          if (overlapsLocal) continue;

          const conflict = await this.checkEncounterSlotConflict(
            session,
            contract.doctorId,
            targetDate,
            candidateTime,
            undefined,
            [EncounterStatus.CONFIRMED, EncounterStatus.IN_PROGRESS, EncounterStatus.REQUESTED],
          );
          if (!conflict.hasConflict) {
            chosenTime = candidateTime;
            break;
          }
        }

        bookedMinutes.push(getTimeWindowMinutes(chosenTime));
        bookedByDay.set(dayKey, bookedMinutes);

        const enc = await session.createEncounter({
          contractId,
          doctorId: contract.doctorId,
          encounterType: defaultType,
          category: EncounterCategory.PERIODIC_ROUTINE,
          visitScope: EncounterVisitScope.FAMILY,
          scheduledDate: targetDate,
          scheduledTime: chosenTime,
          encounterStatus: EncounterStatus.REQUESTED,
          cancelReason: serializeEncounterScheduleMeta(
            {
              stage: 'CADENCE_DRAFT',
              milestoneIndex: i + 1,
              totalMilestones: milestoneDates.length,
            },
            `Khám định kỳ gia đình lần ${i + 1}/${milestoneDates.length} (khung dự thảo mặc định theo gói)`,
          ),
          ...(contract.members.length > 0
            ? {
                participants: {
                  create: contract.members.map((m) => ({ patientId: m.patientId })),
                },
              }
            : {}),
        });
        createdList.push(enrichEncounterWithScheduleMeta(enc));
      }

      // Notify doctor that draft cadence is ready for review
      if (contract.doctor?.user?.id) {
        await session.createNotification({
          userId: contract.doctor.user.id,
          title: 'Khung lịch khám định kỳ mới cần duyệt',
          content: `Hệ thống đã tự động tính toán ${createdList.length} mốc khám định kỳ cho hợp đồng ${contract.contractNumber}. Vui lòng kiểm tra và duyệt lịch.`,
          type: 'ENCOUNTER_CADENCE_DRAFT_READY',
          referenceId: contractId,
        });
      }

      await session.createAuditLog(
        options?.triggeredBy || contract.doctorId,
        'GENERATE_PERIODIC_CADENCE',
        contractId,
      );

      return { generatedCount: createdList.length, encounters: createdList };
    });
  }

  async finalizeCadenceSchedule(actor: AuthenticatedUser, contractId: string) {
    return this.repository.transaction(async (session) => {
      const contract = await session.findContract(contractId);
      if (!contract) throw new NotFoundException('Medical contract not found');

      if (actor.role === 'DOCTOR') {
        const doc = await session.findDoctorByUserId(actor.id);
        if (!doc || doc.id !== contract.doctorId) {
          throw new ForbiddenException('Only the assigned doctor can finalize cadence schedule');
        }
      } else if (actor.role !== 'ADMIN') {
        throw new ForbiddenException('Forbidden');
      }

      const [encounters] = await session.findEncounters({
        contractId,
        category: EncounterCategory.PERIODIC_ROUTINE,
      }, 0, 100);

      const draftEncounters = encounters.filter(
        (e) => parseEncounterScheduleMeta(e).scheduleStage === 'CADENCE_DRAFT',
      );

      if (draftEncounters.length === 0) {
        return { finalizedCount: 0, encounters: [] };
      }

      const updated = [];
      for (const draft of draftEncounters) {
        const meta = parseEncounterScheduleMeta(draft);
        const up = await session.updateEncounter(draft.id, {
          encounterStatus: EncounterStatus.REQUESTED,
          cancelReason: serializeEncounterScheduleMeta(
            {
              stage: 'AWAITING_FAMILY_CONFIRM',
              ...(meta.milestoneIndex !== null ? { milestoneIndex: meta.milestoneIndex } : {}),
              ...(meta.totalMilestones !== null ? { totalMilestones: meta.totalMilestones } : {}),
            },
            'Bác sĩ đã chốt khung lịch khám định kỳ',
          ),
        });
        updated.push(enrichEncounterWithScheduleMeta(up));
      }

      // Notify family
      const familyRepId =
        contract.familyUnit?.representativeUserId || contract.familyUnit?.representativeUser?.id;
      if (familyRepId) {
        await session.createNotification({
          userId: familyRepId,
          title: 'Bác sĩ đã chốt kế hoạch khám định kỳ',
          content: `Bác sĩ ${contract.doctor?.user?.fullName || ''} đã chốt khung lịch khám định kỳ ${updated.length} lần trong năm cho gia đình. Vui lòng xem và xác nhận lịch hẹn.`,
          type: 'ENCOUNTER_FINALIZED_BY_DOCTOR',
          referenceId: contractId,
        });
      }

      await session.createAuditLog(actor.id, 'FINALIZE_CADENCE_SCHEDULE', contractId);
      return { finalizedCount: updated.length, encounters: updated };
    });
  }

  async confirmCadenceSchedule(actor: AuthenticatedUser, contractId: string) {
    if (!['FAMILY_REP', 'ADMIN'].includes(actor.role)) {
      throw new ForbiddenException('Only the family representative or admin can confirm cadence schedule');
    }

    return this.repository.transaction(async (session) => {
      const contract = await session.findContract(contractId);
      if (!contract) throw new NotFoundException('Medical contract not found');
      if (contract.contractStatus !== 'ACTIVE') {
        throw new BadRequestException('Contract is not active');
      }
      if (actor.role === 'FAMILY_REP' && contract.familyUnit.representativeUserId !== actor.id) {
        throw new ForbiddenException('You are not authorized to confirm this contract schedule');
      }

      const [encounters] = await session.findEncounters(
        {
          contractId,
          category: EncounterCategory.PERIODIC_ROUTINE,
          encounterStatus: EncounterStatus.REQUESTED,
        },
        0,
        100,
      );

      const readyEncounters = encounters.filter(
        (e) => parseEncounterScheduleMeta(e).scheduleStage === 'AWAITING_FAMILY_CONFIRM',
      );
      if (readyEncounters.length === 0) {
        return { confirmedCount: 0, encounters: [] };
      }

      const homeNeeded = readyEncounters.filter((e) => e.encounterType === EncounterType.HOME_VISIT).length;
      const teleNeeded = readyEncounters.filter((e) => e.encounterType === EncounterType.TELEHEALTH).length;
      if (homeNeeded > contract.remainingHomeVisits) {
        throw new BadRequestException('Không đủ lượt khám tại nhà còn lại để xác nhận toàn bộ lộ trình');
      }
      if (teleNeeded > contract.remainingTelehealth) {
        throw new BadRequestException('Không đủ lượt tư vấn Telehealth còn lại để xác nhận toàn bộ lộ trình');
      }

      // Check conflicts against existing confirmed/in-progress encounters and within the batch
      const batchSlotsByDay = new Map<string, number[]>();
      for (const enc of readyEncounters) {
        const conflict = await this.checkEncounterSlotConflict(
          session,
          enc.doctorId,
          enc.scheduledDate,
          enc.scheduledTime,
          enc.id,
        );
        if (conflict.hasConflict) {
          throw new ConflictException(conflict.reason);
        }

        const dayKey = enc.scheduledDate.toISOString().slice(0, 10);
        const startMin = getTimeWindowMinutes(enc.scheduledTime);
        const existingInBatch = batchSlotsByDay.get(dayKey) ?? [];
        const overlapsBatch = existingInBatch.some(
          (m) => startMin < m + APPOINTMENT_DURATION_MINUTES && startMin + APPOINTMENT_DURATION_MINUTES > m,
        );
        if (overlapsBatch) {
          throw new ConflictException(`Hai mốc lịch trong cùng ngày ${dayKey} bị trùng khung giờ`);
        }
        existingInBatch.push(startMin);
        batchSlotsByDay.set(dayKey, existingInBatch);
      }

      const tx = (session as unknown as { tx?: Prisma.TransactionClient }).tx;
      const confirmed = [];
      for (const enc of readyEncounters) {
        if (tx && this.slotLedger) {
          const encSlotWindow =
            (enc.slotWindow as 'MORNING' | 'AFTERNOON' | null) ??
            mapTimeToSlotWindow(enc.scheduledTime);
          await this.slotLedger.book(tx, {
            doctorId: enc.doctorId,
            contractId,
            date: enc.scheduledDate.toISOString().slice(0, 10),
            slotWindow: encSlotWindow,
            visitType: enc.encounterType === EncounterType.TELEHEALTH ? 'VIDEO' : 'HOME_VISIT',
            encounterId: enc.id,
          });
        }
        await session.decrementContractQuota(contractId, enc.encounterType);
        const up = await session.updateEncounter(enc.id, {
          encounterStatus: EncounterStatus.CONFIRMED,
        });
        confirmed.push(enrichEncounterWithScheduleMeta(up));
      }

      await session.createAuditLog(actor.id, 'CONFIRM_CADENCE_SCHEDULE', contractId);

      const notifications: Prisma.NotificationUncheckedCreateInput[] = [
        {
          userId: contract.familyUnit.representativeUserId,
          title: 'Đã xác nhận lộ trình khám định kỳ',
          content: `Gia đình đã xác nhận thành công ${confirmed.length} mốc khám định kỳ theo gói. Hệ thống sẽ nhắc hẹn trước 24h và 2h.`,
          type: 'ENCOUNTER_CONFIRMED',
          referenceId: contractId,
        },
      ];
      if (contract.doctor?.user?.id) {
        notifications.push({
          userId: contract.doctor.user.id,
          title: 'Gia đình đã xác nhận lộ trình khám định kỳ',
          content: `Hộ gia đình đã xác nhận ${confirmed.length} mốc khám định kỳ trong hợp đồng ${contract.contractNumber || contractId.slice(0, 8)}.`,
          type: 'ENCOUNTER_CONFIRMED',
          referenceId: contractId,
        });
      }
      if (contract.facility?.userId) {
        notifications.push({
          userId: contract.facility.userId,
          title: 'Đồng bộ lộ trình khám định kỳ',
          content: `Bác sĩ ${contract.doctor?.doctorName || ''} có ${confirmed.length} lịch khám định kỳ đã được xác nhận.`,
          type: 'ENCOUNTER_CONFIRMED',
          referenceId: contractId,
        });
      }
      await session.createNotifications(notifications);

      return { confirmedCount: confirmed.length, encounters: confirmed };
    });
  }

  async adjustCadenceMilestone(
    actor: AuthenticatedUser,
    encounterId: string,
    dto: { scheduledDate?: string; scheduledTime?: string; encounterType?: string },
  ) {
    return this.repository.transaction(async (session) => {
      const encounter = await session.findEncounter(encounterId);
      if (!encounter) throw new NotFoundException('Encounter not found');

      if (actor.role === 'DOCTOR') {
        const doc = await session.findDoctorByUserId(actor.id);
        if (!doc || doc.id !== encounter.doctorId) {
          throw new ForbiddenException('Only assigned doctor can adjust cadence milestone');
        }
      } else if (actor.role !== 'ADMIN') {
        throw new ForbiddenException('Forbidden');
      }

      const parsed = parseEncounterScheduleMeta(encounter);
      if (parsed.scheduleStage !== 'CADENCE_DRAFT') {
        throw new BadRequestException(
          'Chỉ có thể điều chỉnh trực tiếp các mốc lịch ở trạng thái dự thảo (CADENCE_DRAFT). Với lịch đã chốt, vui lòng gửi yêu cầu đổi lịch.',
        );
      }

      const newDate = dto.scheduledDate ? parseDateOnly(dto.scheduledDate) : encounter.scheduledDate;
      const newTime = dto.scheduledTime ? parseTimeToDate(dto.scheduledTime) : encounter.scheduledTime;
      const newType = dto.encounterType ? (dto.encounterType as EncounterType) : encounter.encounterType;

      const conflict = await this.checkEncounterSlotConflict(
        session,
        encounter.doctorId,
        newDate,
        newTime,
        encounterId,
        [EncounterStatus.CONFIRMED, EncounterStatus.IN_PROGRESS, EncounterStatus.REQUESTED],
      );
      if (conflict.hasConflict) {
        throw new ConflictException(conflict.reason);
      }

      const updated = await session.updateEncounter(encounterId, {
        scheduledDate: newDate,
        scheduledTime: newTime,
        encounterType: newType,
        cancelReason: serializeEncounterScheduleMeta(
          {
            stage: 'CADENCE_DRAFT',
            ...(parsed.milestoneIndex !== null ? { milestoneIndex: parsed.milestoneIndex } : {}),
            ...(parsed.totalMilestones !== null ? { totalMilestones: parsed.totalMilestones } : {}),
          },
          parsed.displayNotes,
        ),
      });

      await session.createAuditLog(actor.id, 'ADJUST_CADENCE_MILESTONE', encounterId);
      return enrichEncounterWithScheduleMeta(updated);
    });
  }

  private async expireStaleRescheduleRequests(tx: Prisma.TransactionClient) {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await tx.encounterRescheduleRequest.updateMany({
      where: {
        status: 'PENDING',
        createdAt: { lte: cutoff },
      },
      data: {
        status: 'CANCELLED',
        resolvedAt: new Date(),
      },
    });
  }

  async withdrawRescheduleRequest(
    actor: AuthenticatedUser,
    encounterId: string,
    requestId: string,
  ) {
    return this.repository.transaction(async (session) => {
      const tx = (session as unknown as { tx?: Prisma.TransactionClient }).tx;
      if (tx) {
        await this.expireStaleRescheduleRequests(tx);
      }
      const encounter = await session.findEncounter(encounterId);
      if (!encounter) throw new NotFoundException('Encounter not found');

      const request = await session.findRescheduleRequestById(requestId);
      if (!request || request.encounterId !== encounterId) {
        throw new NotFoundException('Reschedule request not found');
      }
      if (request.status !== 'PENDING') {
        throw new ConflictException('Yêu cầu đổi lịch không còn ở trạng thái chờ duyệt');
      }
      if (actor.role !== 'ADMIN' && request.requestedByUserId !== actor.id) {
        throw new ForbiddenException('Chỉ người gửi mới có quyền thu hồi đề xuất đổi lịch');
      }

      const updated = await session.updateRescheduleRequest(requestId, {
        status: 'CANCELLED',
        resolvedAt: new Date(),
      });
      await session.createAuditLog(actor.id, 'RESCHEDULE_WITHDRAWN', requestId);

      const targetUserId =
        request.requestedByRole === 'FAMILY_REP'
          ? encounter.doctor.user?.id
          : encounter.contract.familyUnit.representativeUserId;
      if (targetUserId) {
        await session.createNotification({
          userId: targetUserId,
          title: 'Đề xuất đổi lịch đã được thu hồi',
          content: 'Bên gửi đã thu hồi yêu cầu đổi lịch. Lịch khám cũ vẫn được giữ nguyên.',
          type: 'ENCOUNTER_RESCHEDULE_WITHDRAWN',
          referenceId: encounter.id,
        });
      }
      return updated;
    });
  }

  async getDoctorMonthlyAvailability(
    actor: AuthenticatedUser,
    doctorId: string,
    month: string,
    contractId?: string,
    _excludeEncounterId?: string,
  ) {
    if (!/^\d{4}-\d{2}$/.test(month)) {
      throw new BadRequestException('month must be in YYYY-MM format');
    }
    const [yearStr, monthStr] = month.split('-');
    const year = Number(yearStr);
    const monthIndex = Number(monthStr) - 1;
    const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();

    return this.repository.transaction(async (session) => {
      const tx = (session as unknown as { tx?: Prisma.TransactionClient }).tx;
      if (tx) {
        await this.expireStaleRescheduleRequests(tx);
      }
      let contractStartIso: string | null = null;
      let contractEndIso: string | null = null;
      if (contractId && tx) {
        const c = await tx.medicalContract.findUnique({
          where: { id: contractId },
          select: { familyId: true, startDate: true, endDate: true },
        });
        contractStartIso = c?.startDate ? c.startDate.toISOString().slice(0, 10) : null;
        contractEndIso = c?.endDate ? c.endDate.toISOString().slice(0, 10) : null;
      }

      const firstDayIso = new Date(Date.UTC(year, monthIndex, 1)).toISOString().slice(0, 10);
      const lastDayIso = new Date(Date.UTC(year, monthIndex, daysInMonth)).toISOString().slice(0, 10);
      const vnNow = new Date(Date.now() + 7 * 60 * 60 * 1000);
      const todayIso = vnNow.toISOString().slice(0, 10);

      const occupied =
        tx && this.slotLedger
          ? await this.slotLedger.listOccupied(tx, doctorId, firstDayIso, lastDayIso)
          : [];

      const occupiedMap = new Map<string, OccupiedSlot>();
      const familyBusyDays = new Set<string>();
      for (const slot of occupied) {
        occupiedMap.set(`${slot.date}:${slot.slotWindow}`, slot);
        if (contractId && slot.contractId === contractId) {
          familyBusyDays.add(slot.date);
        }
      }

      const days = [];
      for (let d = 1; d <= daysInMonth; d++) {
        const dateObj = new Date(Date.UTC(year, monthIndex, d, 0, 0, 0, 0));
        const iso = dateObj.toISOString().slice(0, 10);
        const dayOff = isDayOffDate(dateObj);
        const isOutOfContract =
          (contractStartIso !== null && iso < contractStartIso) ||
          (contractEndIso !== null && iso >= contractEndIso);

        const ctx = {
          todayIso,
          isDayOff: dayOff.isDayOff,
          dayOffReason: dayOff.reason ?? null,
          isOutOfContract,
          contractId,
          familyBusyDays,
        };
        const morning = buildShiftStatus(iso, 'MORNING', occupiedMap, ctx);
        const afternoon = buildShiftStatus(iso, 'AFTERNOON', occupiedMap, ctx);

        days.push({
          date: iso,
          isDayOff: dayOff.isDayOff,
          dayOffReason: dayOff.reason ?? null,
          isOutOfContract,
          outOfContractReason: isOutOfContract ? 'Ngoài hạn hợp đồng' : null,
          familyHasVisit: familyBusyDays.has(iso),
          morning,
          afternoon,
        });
      }

      return {
        month,
        doctorId,
        contractStartDate: contractStartIso,
        contractEndDate: contractEndIso,
        days,
      };
    });
  }

  async getDoctorVideoAvailability(
    actor: AuthenticatedUser,
    doctorId: string,
    month: string,
    contractId?: string,
  ) {
    if (!/^\d{4}-\d{2}$/.test(month)) {
      throw new BadRequestException('month must be in YYYY-MM format');
    }
    const [yearStr, monthStr] = month.split('-');
    const year = Number(yearStr);
    const monthIndex = Number(monthStr) - 1;
    const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();

    return this.repository.transaction(async (session) => {
      const tx = (session as unknown as { tx?: Prisma.TransactionClient }).tx;
      const now = new Date();
      const vnNow = new Date(now.getTime() + 7 * 60 * 60 * 1000);
      const todayIso = vnNow.toISOString().slice(0, 10);
      const maxAdvanceDate = new Date(vnNow.getTime() + 30 * 24 * 60 * 60 * 1000);
      let maxDateIso = maxAdvanceDate.toISOString().slice(0, 10);
      let contractStartIso: string | null = null;
      let contractEndIso: string | null = null;

      if (contractId && tx) {
        const contract = await tx.medicalContract.findUnique({
          where: { id: contractId },
          select: { startDate: true, endDate: true },
        });
        if (contract?.startDate) {
          contractStartIso = contract.startDate.toISOString().slice(0, 10);
        }
        if (contract?.endDate) {
          contractEndIso = contract.endDate.toISOString().slice(0, 10);
          if (contractEndIso < maxDateIso) maxDateIso = contractEndIso;
        }
      }

      const firstDayIso = new Date(Date.UTC(year, monthIndex, 1)).toISOString().slice(0, 10);
      const lastDayIso = new Date(Date.UTC(year, monthIndex, daysInMonth)).toISOString().slice(0, 10);

      const occupied =
        tx && this.slotLedger
          ? await this.slotLedger.listOccupied(tx, doctorId, firstDayIso, lastDayIso)
          : [];

      const occupiedMap = new Map<string, OccupiedSlot>();
      const familyBusyDays = new Set<string>();
      for (const slot of occupied) {
        occupiedMap.set(`${slot.date}:${slot.slotWindow}`, slot);
        if (contractId && slot.contractId === contractId) {
          familyBusyDays.add(slot.date);
        }
      }

      const days = [];
      let nearestAvailableSlot: {
        date: string;
        slotWindow: 'MORNING' | 'AFTERNOON';
        suggestedTime: string;
      } | null = null;

      for (let d = 1; d <= daysInMonth; d++) {
        const dateObj = new Date(Date.UTC(year, monthIndex, d, 0, 0, 0, 0));
        const iso = dateObj.toISOString().slice(0, 10);
        const dayOff = isDayOffDate(dateObj);
        const isOutOfContract =
          (contractStartIso !== null && iso < contractStartIso) ||
          iso > maxDateIso;

        const ctx = {
          todayIso,
          isDayOff: dayOff.isDayOff,
          dayOffReason: dayOff.reason ?? null,
          isOutOfContract,
          contractId,
          familyBusyDays,
        };
        const mStatus = buildShiftStatus(iso, 'MORNING', occupiedMap, ctx);
        const aStatus = buildShiftStatus(iso, 'AFTERNOON', occupiedMap, ctx);
        const morning = {
          ...mStatus,
          candidateTimes: mStatus.available ? ['08:00'] : [],
        };
        const afternoon = {
          ...aStatus,
          candidateTimes: aStatus.available ? ['13:30'] : [],
        };

        if (!nearestAvailableSlot) {
          if (morning.available) {
            nearestAvailableSlot = { date: iso, slotWindow: 'MORNING', suggestedTime: '08:00' };
          } else if (afternoon.available) {
            nearestAvailableSlot = { date: iso, slotWindow: 'AFTERNOON', suggestedTime: '13:30' };
          }
        }

        days.push({
          date: iso,
          isDayOff: dayOff.isDayOff,
          outOfRange: iso <= todayIso || isOutOfContract,
          morning,
          afternoon,
        });
      }

      return { month, doctorId, maxDateIso, nearestAvailableSlot, days };
    });
  }

  async doctorManualSchedule(
    actor: AuthenticatedUser,
    encounterId: string,
    dto: { proposedDate: string; slotWindow: 'MORNING' | 'AFTERNOON' },
  ) {
    return this.repository.transaction(async (session) => {
      const encounter = await session.findEncounter(encounterId);
      if (!encounter) {
        throw new NotFoundException('Encounter not found');
      }

      const tx = (session as unknown as { tx?: Prisma.TransactionClient }).tx;
      if (tx && typeof (tx as { $executeRaw?: unknown }).$executeRaw === 'function') {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${encounter.doctorId}))`;
      }

      const targetDate = parseDateOnly(dto.proposedDate);
      const nowManual = new Date();
      const targetDeadlineUtc = new Date(
        Date.UTC(
          targetDate.getUTCFullYear(),
          targetDate.getUTCMonth(),
          targetDate.getUTCDate() - 1,
          13, // 20:00 UTC+7 = 13:00 UTC
          0,
          0,
          0,
        ),
      );
      if (nowManual.getTime() > targetDeadlineUtc.getTime()) {
        throw new BadRequestException(
          'Không thể xếp lịch vào ngày hôm nay hoặc quá khứ (phải xếp trước 20:00 tối hôm trước).',
        );
      }
      const dayOff = isDayOffDate(targetDate);
      if (dayOff.isDayOff) {
        throw new BadRequestException(dayOff.reason || 'Ngày đã chọn là ngày nghỉ');
      }

      if (tx && this.slotLedger) {
        await this.slotLedger.book(tx, {
          doctorId: encounter.doctorId,
          contractId: encounter.contractId,
          date: dto.proposedDate,
          slotWindow: dto.slotWindow,
          visitType: encounter.encounterType === EncounterType.TELEHEALTH ? 'VIDEO' : 'HOME_VISIT',
          encounterId,
        });
      }

      const parsed = parseEncounterScheduleMeta(encounter);
      const scheduledTime = slotWindowToScheduledTime(dto.slotWindow);
      const updated = await session.updateEncounter(encounterId, {
        scheduledDate: targetDate,
        scheduledTime,
        slotWindow: dto.slotWindow,
        encounterStatus: EncounterStatus.CONFIRMED,
        cancelReason: serializeEncounterScheduleMeta(
          {
            stage: 'DOCTOR_MANUAL_CONFIRMED',
            slotWindow: dto.slotWindow,
            ...(parsed.milestoneIndex !== null ? { milestoneIndex: parsed.milestoneIndex } : {}),
            ...(parsed.totalMilestones !== null ? { totalMilestones: parsed.totalMilestones } : {}),
          },
          `Bác sĩ đã xếp lịch thủ công (${dto.slotWindow === 'MORNING' ? 'Khung Sáng 08:00-11:30' : 'Khung Chiều 13:30-17:30'})`,
        ),
      });

      await session.createAuditLog(actor.id, 'DOCTOR_MANUAL_SCHEDULE', encounterId);
      return enrichEncounterWithScheduleMeta(updated);
    });
  }

  async retryContractAutoSchedule(actor: AuthenticatedUser, contractId: string) {
    return this.repository.transaction(async (session) => {
      const tx = (session as unknown as { tx?: Prisma.TransactionClient }).tx;
      if (!tx) {
        throw new BaseApiException({
          errorCode: AutoScheduleErrorCode.AUTO_SCHEDULE_TRANSACTION_UNAVAILABLE,
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          message:
            'Không mở được phiên xử lý dữ liệu để xếp lịch. Vui lòng thử lại sau.',
        });
      }
      const contract = await tx.medicalContract.findUnique({
        where: { id: contractId },
        select: {
          contractStatus: true,
          doctorId: true,
          homeVisitAddress: true,
          familyUnit: { select: { homeAddress: true } },
        },
      });
      if (!contract) {
        throw new ResourceNotFoundException(
          ContractErrorCode.CONTRACT_NOT_FOUND,
          'Không tìm thấy hợp đồng cần xếp lịch.',
        );
      }
      if (contract.contractStatus !== 'ACTIVE') {
        throw new BaseApiException({
          errorCode: ContractErrorCode.CONTRACT_NOT_ACTIVE,
          status: HttpStatus.BAD_REQUEST,
          message: 'Hợp đồng chưa được kích hoạt nên chưa thể xếp lịch.',
          conditions: [
            {
              code: 'CONTRACT_ACTIVE',
              condition: 'Hợp đồng phải ở trạng thái ACTIVE',
              message: `Hợp đồng đang ở trạng thái ${contract.contractStatus}.`,
            },
          ],
        });
      }
      const missingReasons: string[] = [];
      if (!contract.doctorId) missingReasons.push('Bác sĩ phụ trách');
      if (
        !isValidHomeVisitAddress(contract.homeVisitAddress) &&
        !isValidHomeVisitAddress(contract.familyUnit?.homeAddress)
      ) {
        missingReasons.push('Địa chỉ khám tại nhà');
      }
      if (missingReasons.length > 0) {
        throw new BaseApiException({
          errorCode: AutoScheduleErrorCode.AUTO_SCHEDULE_MISSING_DATA,
          status: HttpStatus.BAD_REQUEST,
          message: `Hợp đồng còn thiếu: ${missingReasons.join(', ')}.`,
          conditions: missingReasons.map((reason) => ({
            code:
              reason === 'Bác sĩ phụ trách'
                ? 'CONTRACT_DOCTOR_REQUIRED'
                : 'HOME_VISIT_ADDRESS_REQUIRED',
            condition: `Hợp đồng phải có ${reason.toLowerCase()}`,
            message: `Hợp đồng chưa có ${reason.toLowerCase()}.`,
          })),
        });
      }
      const autoScheduler = new AutoScheduleFirstVisitService(this.slotLedger);
      const created = await autoScheduler.scheduleOnContractActivated(tx, contractId);
      await session.createAuditLog(actor.id, 'RETRY_AUTO_SCHEDULE', contractId);
      return {
        scheduledCount: created.length,
        encounters: created.map((e) => enrichEncounterWithScheduleMeta(e)),
      };
    });
  }
}
