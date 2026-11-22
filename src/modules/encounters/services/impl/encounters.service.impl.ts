import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../../../../core/auth/authenticated-request';
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
import {
  EncounterCategory,
  EncounterStatus,
  EncounterType,
  EncounterVisitScope,
  Prisma,
  RescheduleDecision,
} from '@prisma/client';

export const APPOINTMENT_DURATION_MINUTES = 45;
export const RESCHEDULE_MIN_NOTICE_HOURS = 4;
export const MAX_RESCHEDULE_COUNT = 3;

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
        cancelReason: dto.notes ?? null,
        ...(participantIds.length > 0
          ? {
              participants: {
                create: participantIds.map((patientId) => ({ patientId })),
              },
            }
          : {}),
      });

      await session.createAuditLog(actor.id, 'CREATE_PERIODIC_ENCOUNTER', encounter.id);

      await session.createNotification({
        userId: contract.familyUnit.representativeUserId,
        title: 'Lịch khám định kỳ mới được đề xuất',
        content: `Bác sĩ đã đề xuất lịch khám định kỳ cho ngày ${dto.scheduledDate} lúc ${dto.scheduledTime}. Vui lòng xác nhận.`,
        type: 'ENCOUNTER_PROPOSED',
        referenceId: encounter.id,
      });

      return encounter;
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

      const scheduledDate = parseDateOnly(dto.desiredDate);
      const scheduledTime = parseTimeToDate(dto.desiredTime);

      const encounter = await session.createEncounter({
        contractId: contract.id,
        doctorId: contract.doctorId,
        encounterType: dto.encounterType,
        category: EncounterCategory.AD_HOC_ON_DEMAND,
        visitScope,
        scheduledDate,
        scheduledTime,
        encounterStatus: EncounterStatus.REQUESTED,
        cancelReason: dto.reason,
        ...(participantIds.length > 0
          ? {
              participants: {
                create: participantIds.map((patientId) => ({ patientId })),
              },
            }
          : {}),
      });

      await session.createAuditLog(actor.id, 'CREATE_ADHOC_ENCOUNTER', encounter.id);

      // Notify attending doctor
      if (contract.doctor?.user?.id) {
        await session.createNotification({
          userId: contract.doctor.user.id,
          title: 'Yêu cầu khám đột xuất mới từ gia đình',
          content: `Hộ gia đình yêu cầu khám đột xuất cho ngày ${dto.desiredDate} lúc ${dto.desiredTime}. Lý do: ${dto.reason}`,
          type: 'ENCOUNTER_ADHOC_REQUESTED',
          referenceId: encounter.id,
        });
      }

      return encounter;
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

      const updateData: Prisma.EncounterUncheckedUpdateInput = {};
      if (dto.encounterType) updateData.encounterType = dto.encounterType;
      if (dto.scheduledDate) updateData.scheduledDate = parseDateOnly(dto.scheduledDate);
      if (dto.scheduledTime) updateData.scheduledTime = parseTimeToDate(dto.scheduledTime);
      if (dto.doctorNotes) updateData.cancelReason = dto.doctorNotes;

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

      return updated;
    });
  }

  async confirmEncounter(actor: AuthenticatedUser, encounterId: string, dto: ConfirmEncounterDto) {
    if (!['FAMILY_REP', 'ADMIN'].includes(actor.role)) {
      throw new ForbiddenException('Only the family representative or admin can confirm the schedule');
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

      if (!dto.confirmed) {
        throw new BadRequestException('To propose an alternative time, please use the reschedule endpoint');
      }

      // Check for conflicts with other confirmed/in-progress encounters on the platform
      const conflictResult = await this.checkEncounterSlotConflict(
        session,
        encounter.doctorId,
        encounter.scheduledDate,
        encounter.scheduledTime,
        encounter.id,
      );

      if (conflictResult.hasConflict) {
        throw new ConflictException(conflictResult.reason);
      }

      // No conflict -> Save finalized schedule and synchronize across all three parties
      await session.decrementContractQuota(encounter.contractId, encounter.encounterType);

      const confirmedEncounter = await session.updateEncounter(encounterId, {
        encounterStatus: EncounterStatus.CONFIRMED,
      });

      await session.createAuditLog(actor.id, 'CONFIRM_ENCOUNTER', encounterId);

      // Synchronize notifications across Doctor, Family, and Facility
      const notifications: Prisma.NotificationUncheckedCreateInput[] = [
        {
          userId: encounter.contract.familyUnit.representativeUserId,
          title: 'Lịch khám đã được xác nhận',
          content: `Lịch khám ngày ${encounter.scheduledDate.toISOString().slice(0, 10)} đã xác nhận thành công. Hệ thống sẽ nhắc bạn trước 24h và 2h.`,
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
          content: `Lịch khám cho ${patientLabel} ngày ${encounter.scheduledDate.toISOString().slice(0, 10)} đã được xác nhận.`,
          type: 'ENCOUNTER_CONFIRMED',
          referenceId: encounter.id,
        });
      }

      if (encounter.contract.facility.user?.id) {
        notifications.push({
          userId: encounter.contract.facility.user.id,
          title: 'Đồng bộ lịch khám ngoại viện bác sĩ',
          content: `Bác sĩ ${encounter.doctor.doctorName} có lịch khám xác nhận ngày ${encounter.scheduledDate.toISOString().slice(0, 10)}.`,
          type: 'ENCOUNTER_SYNC_FACILITY',
          referenceId: encounter.id,
        });
      }

      await session.createNotifications(notifications);

      return confirmedEncounter;
    });
  }

  async requestReschedule(actor: AuthenticatedUser, encounterId: string, dto: RequestRescheduleDto) {
    if (!['FAMILY_REP', 'DOCTOR', 'ADMIN'].includes(actor.role)) {
      throw new ForbiddenException('Only family representative, assigned doctor, or admin can request reschedule');
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

      if (encounter.rescheduleCount >= MAX_RESCHEDULE_COUNT) {
        throw new BadRequestException(
          `Maximum reschedule limit (${MAX_RESCHEDULE_COUNT} times) exceeded. Please contact the healthcare facility hotline.`,
        );
      }

      const existingPending = await session.findPendingRescheduleRequestByEncounter(encounterId);
      if (existingPending) {
        throw new ConflictException('This encounter already has a pending reschedule request');
      }

      // Check remaining time before examination (4-hour SLA rule)
      const scheduledDateTime = combineDateAndTime(encounter.scheduledDate, encounter.scheduledTime);
      const now = new Date();
      const diffHours = (scheduledDateTime.getTime() - now.getTime()) / (1000 * 60 * 60);

      if (diffHours < RESCHEDULE_MIN_NOTICE_HOURS) {
        await session.createAuditLog(actor.id, 'RESCHEDULE_REJECTED_UNDER_4H', encounterId);
        await session.createNotification({
          userId: actor.id,
          title: 'Yêu cầu đổi lịch bị từ chối do không đủ thời gian báo trước',
          content: 'Yêu cầu đổi lịch phải được gửi trước ít nhất 4 giờ. Vui lòng liên hệ Hotline hỗ trợ để được can thiệp khẩn cấp.',
          type: 'RESCHEDULE_REJECTED_UNDER_4H',
          referenceId: encounter.id,
        });

        throw new BadRequestException(
          'Automatically rejected the rescheduling request due to insufficient advance notice (< 4 hours). Please contact the support hotline.',
        );
      }

      const proposedDate = parseDateOnly(dto.proposedDate);
      const proposedTime = parseTimeToDate(dto.proposedTime);

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

      const requestedByRole = actor.role === 'DOCTOR' ? 'DOCTOR' : 'FAMILY_REP';
      const request = await session.createRescheduleRequest({
        encounterId: encounter.id,
        requestedByRole,
        requestedByUserId: actor.id,
        proposedDate,
        proposedTime,
        reason: dto.rescheduleReason,
        familyDecision: requestedByRole === 'FAMILY_REP' ? RescheduleDecision.APPROVED : RescheduleDecision.PENDING,
        familyDecidedBy: requestedByRole === 'FAMILY_REP' ? actor.id : null,
        familyDecidedAt: requestedByRole === 'FAMILY_REP' ? now : null,
        doctorDecision: requestedByRole === 'DOCTOR' ? RescheduleDecision.APPROVED : RescheduleDecision.PENDING,
        doctorDecidedBy: requestedByRole === 'DOCTOR' ? actor.id : null,
        doctorDecidedAt: requestedByRole === 'DOCTOR' ? now : null,
        facilityDecision: RescheduleDecision.PENDING,
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
          title: 'Bác sĩ yêu cầu đổi lịch khám',
          content: `Bác sĩ đề xuất đổi sang ngày ${dto.proposedDate} lúc ${dto.proposedTime}. Lý do: ${dto.rescheduleReason}`,
          type: 'ENCOUNTER_RESCHEDULE_REQUESTED',
          referenceId: encounter.id,
        });
      }

      if (encounter.contract.facility.user?.id) {
        notifications.push({
          userId: encounter.contract.facility.user.id,
          title: 'Yêu cầu đổi lịch khám cần CSYT phê duyệt',
          content: `${requestedByRole === 'FAMILY_REP' ? 'Gia đình' : 'Bác sĩ'} đề xuất đổi lịch khám sang ngày ${dto.proposedDate} lúc ${dto.proposedTime}.`,
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
    if (!['FAMILY_REP', 'DOCTOR', 'HEALTHCARE_FACILITY', 'ADMIN'].includes(actor.role)) {
      throw new ForbiddenException('You are not authorized to review reschedule requests');
    }

    return this.repository.transaction(async (session) => {
      const encounter = await session.findEncounter(encounterId);
      if (!encounter) throw new NotFoundException('Encounter not found');

      const request = await session.findRescheduleRequestById(requestId);
      if (!request || request.encounterId !== encounterId) {
        throw new NotFoundException('Reschedule request not found');
      }
      if (request.status !== 'PENDING') {
        throw new ConflictException('Reschedule request is already resolved');
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
      if (actor.role === 'HEALTHCARE_FACILITY') {
        const fac = await session.findFacilityByUserId(actor.id);
        if (!fac || fac.id !== encounter.contract.facilityId) {
          throw new ForbiddenException('You are not the facility for this encounter');
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
      } else if (actor.role === 'HEALTHCARE_FACILITY') {
        if (request.facilityDecision !== RescheduleDecision.PENDING) {
          throw new ConflictException('Facility decision has already been recorded');
        }
        updateData.facilityDecision = decisionEnum;
        updateData.facilityDecidedBy = actor.id;
        updateData.facilityDecidedAt = now;
        updateData.facilityNote = dto.note ?? null;
      } else {
        // ADMIN fallback
        updateData.facilityDecision = decisionEnum;
        updateData.facilityDecidedBy = actor.id;
        updateData.facilityDecidedAt = now;
        updateData.facilityNote = dto.note ?? null;
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
        await session.createNotifications(notifications);
        return rejected;
      }

      const nextFamily = (updateData.familyDecision as RescheduleDecision | undefined) ?? request.familyDecision;
      const nextDoctor = (updateData.doctorDecision as RescheduleDecision | undefined) ?? request.doctorDecision;
      const nextFacility = (updateData.facilityDecision as RescheduleDecision | undefined) ?? request.facilityDecision;

      const allThreeApproved =
        nextFamily === RescheduleDecision.APPROVED &&
        nextDoctor === RescheduleDecision.APPROVED &&
        nextFacility === RescheduleDecision.APPROVED;

      if (!allThreeApproved) {
        const partial = await session.updateRescheduleRequest(request.id, updateData);
        await session.createAuditLog(actor.id, 'PARTIAL_APPROVE_RESCHEDULE', request.id);
        return partial;
      }

      // All 3 parties agreed -> Verify slot is still free on platform
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

      await session.updateEncounter(encounter.id, {
        scheduledDate: request.proposedDate,
        scheduledTime: request.proposedTime,
        rescheduleCount: { increment: 1 },
        reminder24hSentAt: null,
        reminder2hSentAt: null,
      });

      updateData.status = 'APPROVED';
      updateData.resolvedAt = now;
      const approved = await session.updateRescheduleRequest(request.id, updateData);
      await session.createAuditLog(actor.id, 'APPROVE_RESCHEDULE_REQUEST', request.id);

      const newDateStr = request.proposedDate.toISOString().slice(0, 10);
      const newTimeStr = request.proposedTime.toISOString().slice(11, 16);
      const notifications: Prisma.NotificationUncheckedCreateInput[] = [
        {
          userId: encounter.contract.familyUnit.representativeUserId,
          title: 'Đổi lịch khám thành công (3 bên đồng thuận)',
          content: `Lịch khám đã được cập nhật sang ${newTimeStr} ngày ${newDateStr}.`,
          type: 'ENCOUNTER_RESCHEDULE_APPROVED',
          referenceId: encounter.id,
        },
      ];
      if (encounter.doctor.user?.id) {
        notifications.push({
          userId: encounter.doctor.user.id,
          title: 'Đổi lịch khám thành công (3 bên đồng thuận)',
          content: `Lịch khám đã được cập nhật sang ${newTimeStr} ngày ${newDateStr}.`,
          type: 'ENCOUNTER_RESCHEDULE_APPROVED',
          referenceId: encounter.id,
        });
      }
      if (encounter.contract.facility.user?.id) {
        notifications.push({
          userId: encounter.contract.facility.user.id,
          title: 'Đổi lịch khám thành công (3 bên đồng thuận)',
          content: `Lịch khám của ${encounter.doctor.doctorName} đã chuyển sang ${newTimeStr} ngày ${newDateStr}.`,
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
        data: items,
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
        data: items,
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
        encounters: encounters[0],
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

      return encounter;
    });
  }

  // Conflict Checking Engine between Platform Encounters of the same doctor
  private async checkEncounterSlotConflict(
    session: EncountersSession,
    doctorId: string,
    scheduledDate: Date,
    scheduledTime: Date,
    excludeEncounterId?: string,
  ): Promise<{ hasConflict: boolean; reason?: string }> {
    const encStartMin = getTimeWindowMinutes(scheduledTime);
    const encEndMin = encStartMin + APPOINTMENT_DURATION_MINUTES;

    const otherEncounters = await session.findDoctorOverlappingEncounters(
      doctorId,
      scheduledDate,
      excludeEncounterId,
      [EncounterStatus.CONFIRMED, EncounterStatus.IN_PROGRESS],
    );

    for (const other of otherEncounters) {
      const otherStartMin = getTimeWindowMinutes(other.scheduledTime);
      const otherEndMin = otherStartMin + APPOINTMENT_DURATION_MINUTES;

      if (encStartMin < otherEndMin && encEndMin > otherStartMin) {
        return {
          hasConflict: true,
          reason: `Trùng với một lịch khám đã xác nhận khác của bác sĩ lúc ${other.scheduledTime.toISOString().slice(11, 16)}`,
        };
      }
    }

    return { hasConflict: false };
  }
}
