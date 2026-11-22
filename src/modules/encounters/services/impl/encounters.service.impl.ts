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
import type { DoctorRescheduleReviewDto } from '../../dtos/doctor-reschedule-review.dto';
import type { CreateDoctorShiftDto } from '../../dtos/create-doctor-shift.dto';
import type { ListEncountersQueryDto } from '../../dtos/list-encounters-query.dto';
import { EncounterCategory, EncounterStatus, EncounterType, Prisma } from '@prisma/client';

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

      const isMember = await session.isPatientInContract(dto.patientId, contract.id);
      if (!isMember) {
        throw new BadRequestException('Patient is not a covered member of this contract');
      }

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
        patientId: dto.patientId,
        doctorId,
        encounterType: dto.encounterType,
        category: EncounterCategory.PERIODIC_ROUTINE,
        scheduledDate,
        scheduledTime,
        proposedBy: 'DOCTOR',
        encounterStatus: EncounterStatus.REQUESTED,
        cancelReason: dto.notes ?? null,
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

      const isMember = await session.isPatientInContract(dto.patientId, contract.id);
      if (!isMember) {
        throw new BadRequestException('Patient is not a covered member of this contract');
      }
      if (!contract.doctorId) {
        throw new BadRequestException('No attending doctor assigned to this contract');
      }

      const scheduledDate = parseDateOnly(dto.desiredDate);
      const scheduledTime = parseTimeToDate(dto.desiredTime);

      const encounter = await session.createEncounter({
        contractId: contract.id,
        patientId: dto.patientId,
        doctorId: contract.doctorId,
        encounterType: dto.encounterType,
        category: EncounterCategory.AD_HOC_ON_DEMAND,
        scheduledDate,
        scheduledTime,
        proposedBy: 'FAMILY_REP',
        encounterStatus: EncounterStatus.REQUESTED,
        cancelReason: dto.reason,
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

      const updateData: Prisma.EncounterUncheckedUpdateInput = {
        proposedBy: 'DOCTOR',
        proposedDate: null,
        proposedTime: null,
        conflictAlert: false,
        conflictDetails: null,
      };
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

      if (encounter.proposedBy === 'FAMILY_REP') {
        throw new BadRequestException('Schedule is awaiting doctor review before family confirmation');
      }

      const targetDate =
        encounter.proposedBy === 'DOCTOR' && encounter.proposedDate
          ? encounter.proposedDate
          : encounter.scheduledDate;
      const targetTime =
        encounter.proposedBy === 'DOCTOR' && encounter.proposedTime
          ? encounter.proposedTime
          : encounter.scheduledTime;

      // Check for conflicts between examination schedule and healthcare facility duty shifts
      const conflictResult = await this.checkDutyShiftConflicts(
        session,
        encounter.doctorId,
        targetDate,
        targetTime,
        encounter.id,
      );

      if (conflictResult.hasConflict) {
        // Record conflict alert, notify doctor and facility
        await session.updateEncounter(encounterId, {
          conflictAlert: true,
          conflictDetails: conflictResult.reason,
        });

        // Alert doctor
        if (encounter.doctor.user?.id) {
          await session.createNotification({
            userId: encounter.doctor.user.id,
            title: 'CẢNH BÁO: Xung đột ca trực tại CSYT',
            content: `Lịch khám ngày ${targetDate.toISOString().slice(0, 10)} bị xung đột: ${conflictResult.reason}`,
            type: 'ENCOUNTER_DUTY_SHIFT_CONFLICT',
            referenceId: encounter.id,
          });
        }

        // Alert healthcare facility
        if (encounter.contract.facility.user?.id) {
          await session.createNotification({
            userId: encounter.contract.facility.user.id,
            title: 'CẢNH BÁO ĐIỀU PHỐI: Trùng ca trực bác sĩ',
            content: `Bác sĩ ${encounter.doctor.doctorName} có lịch khám ngoại viện trùng ca trực CSYT: ${conflictResult.reason}`,
            type: 'ENCOUNTER_DUTY_SHIFT_CONFLICT',
            referenceId: encounter.id,
          });
        }

        return {
          status: 'CONFLICT_ALERT',
          message: 'Scheduling conflict detected with Healthcare Facility duty shifts. Alert sent to Doctor and Facility.',
          conflictDetails: conflictResult.reason,
          encounter: await session.findEncounter(encounterId),
        };
      }

      // No conflict -> Save finalized schedule and synchronize across all three parties
      await session.decrementContractQuota(encounter.contractId, encounter.encounterType);

      const confirmedEncounter = await session.updateEncounter(encounterId, {
        scheduledDate: targetDate,
        scheduledTime: targetTime,
        proposedDate: null,
        proposedTime: null,
        proposedBy: null,
        encounterStatus: EncounterStatus.CONFIRMED,
        conflictAlert: false,
        conflictDetails: null,
      });

      await session.createAuditLog(actor.id, 'CONFIRM_ENCOUNTER', encounterId);

      // Synchronize notifications across Doctor, Family, and Facility
      const targetDateStr = targetDate.toISOString().slice(0, 10);
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
        notifications.push({
          userId: encounter.doctor.user.id,
          title: 'Gia đình đã xác nhận lịch khám',
          content: `Lịch khám cho bệnh nhân ${encounter.patient.fullName} ngày ${targetDateStr} đã được xác nhận.`,
          type: 'ENCOUNTER_CONFIRMED',
          referenceId: encounter.id,
        });
      }

      if (encounter.contract.facility.user?.id) {
        notifications.push({
          userId: encounter.contract.facility.user.id,
          title: 'Đồng bộ lịch khám ngoại viện bác sĩ',
          content: `Bác sĩ ${encounter.doctor.doctorName} có lịch khám xác nhận ngày ${targetDateStr}.`,
          type: 'ENCOUNTER_SYNC_FACILITY',
          referenceId: encounter.id,
        });
      }

      await session.createNotifications(notifications);

      return confirmedEncounter;
    });
  }

  async requestReschedule(actor: AuthenticatedUser, encounterId: string, dto: RequestRescheduleDto) {
    if (!['FAMILY_REP', 'ADMIN'].includes(actor.role)) {
      throw new ForbiddenException('Only the family representative or admin can request reschedule');
    }

    return this.repository.transaction(async (session) => {
      const encounter = await session.findEncounter(encounterId);
      if (!encounter) throw new NotFoundException('Encounter not found');

      if (actor.role === 'FAMILY_REP' && encounter.contract.familyUnit.representativeUserId !== actor.id) {
        throw new ForbiddenException('You are not authorized to reschedule this encounter');
      }

      if (encounter.rescheduleCount >= MAX_RESCHEDULE_COUNT) {
        throw new BadRequestException(
          `Maximum reschedule limit (${MAX_RESCHEDULE_COUNT} times) exceeded. Please contact the healthcare facility hotline.`,
        );
      }

      // Check remaining time before examination (4-hour SLA rule)
      const scheduledDateTime = combineDateAndTime(encounter.scheduledDate, encounter.scheduledTime);
      const now = new Date();
      const diffHours = (scheduledDateTime.getTime() - now.getTime()) / (1000 * 60 * 60);

      if (diffHours < RESCHEDULE_MIN_NOTICE_HOURS) {
        // Automatically reject the rescheduling request due to insufficient advance notice
        await session.createAuditLog(actor.id, 'RESCHEDULE_REJECTED_UNDER_4H', encounterId);

        await session.createNotification({
          userId: encounter.contract.familyUnit.representativeUserId,
          title: 'Yêu cầu đổi lịch bị từ chối do không đủ thời gian báo trước',
          content: `Yêu cầu đổi lịch phải được gửi trước ít nhất 4 giờ. Vui lòng liên hệ Hotline hỗ trợ để được can thiệp khẩn cấp.`,
          type: 'RESCHEDULE_REJECTED_UNDER_4H',
          referenceId: encounter.id,
        });

        throw new BadRequestException(
          'Automatically rejected the rescheduling request due to insufficient advance notice (< 4 hours). Please contact the support hotline.',
        );
      }

      // Receive rescheduling request and notify doctor
      const proposedDate = parseDateOnly(dto.proposedDate);
      const proposedTime = parseTimeToDate(dto.proposedTime);

      const updated = await session.updateEncounter(encounterId, {
        proposedDate,
        proposedTime,
        proposedBy: 'FAMILY_REP',
        rescheduleReason: dto.rescheduleReason,
        rescheduleCount: { increment: 1 },
      });

      await session.createAuditLog(actor.id, 'REQUEST_RESCHEDULE', encounterId);

      if (encounter.doctor.user?.id) {
        await session.createNotification({
          userId: encounter.doctor.user.id,
          title: 'Gia đình yêu cầu đổi lịch khám',
          content: `Gia đình đề xuất đổi sang ngày ${dto.proposedDate} lúc ${dto.proposedTime}. Lý do: ${dto.rescheduleReason}`,
          type: 'ENCOUNTER_RESCHEDULE_REQUESTED',
          referenceId: encounter.id,
        });
      }

      return updated;
    });
  }

  async reviewReschedule(actor: AuthenticatedUser, encounterId: string, dto: DoctorRescheduleReviewDto) {
    if (!['DOCTOR', 'ADMIN'].includes(actor.role)) {
      throw new ForbiddenException('Only the assigned doctor or admin can review reschedule requests');
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

      if (dto.accept) {
        // Doctor accepts the proposed time from the family
        if (!encounter.proposedDate || !encounter.proposedTime) {
          throw new BadRequestException('No proposed schedule available to accept');
        }

        const newDate = encounter.proposedDate;
        const newTime = encounter.proposedTime;

        // Check for conflicts between examination schedule and healthcare facility duty shifts
        const conflictResult = await this.checkDutyShiftConflicts(
          session,
          encounter.doctorId,
          newDate,
          newTime,
          encounter.id,
        );

        if (conflictResult.hasConflict) {
          await session.updateEncounter(encounterId, {
            conflictAlert: true,
            conflictDetails: conflictResult.reason,
          });

          // Alert doctor and facility
          if (encounter.doctor.user?.id) {
            await session.createNotification({
              userId: encounter.doctor.user.id,
              title: 'CẢNH BÁO: Xung đột ca trực khi chấp thuận đổi lịch',
              content: `Khung giờ mới ${newDate.toISOString().slice(0, 10)} bị xung đột ca trực: ${conflictResult.reason}`,
              type: 'ENCOUNTER_DUTY_SHIFT_CONFLICT',
              referenceId: encounter.id,
            });
          }

          return {
            status: 'CONFLICT_ALERT',
            message: 'Scheduling conflict detected with duty shifts. Alert sent to Doctor and Healthcare Facility.',
            conflictDetails: conflictResult.reason,
            encounter: await session.findEncounter(encounterId),
          };
        }

        // Save finalized schedule and synchronize across all three parties
        const confirmed = await session.updateEncounter(encounterId, {
          scheduledDate: newDate,
          scheduledTime: newTime,
          proposedDate: null,
          proposedTime: null,
          proposedBy: null,
          encounterStatus: EncounterStatus.CONFIRMED,
          conflictAlert: false,
          conflictDetails: null,
        });

        await session.createAuditLog(actor.id, 'DOCTOR_ACCEPT_RESCHEDULE', encounterId);

        // Notify family of acceptance
        await session.createNotification({
          userId: encounter.contract.familyUnit.representativeUserId,
          title: 'Bác sĩ đã chấp thuận lịch hẹn mới',
          content: `Lịch khám đã được dời sang ngày ${newDate.toISOString().slice(0, 10)} thành công.`,
          type: 'RESCHEDULE_ACCEPTED',
          referenceId: encounter.id,
        });

        return confirmed;
      }

      // Doctor does NOT accept the proposed time
      if (dto.counterDate && dto.counterTime) {
        // Doctor proposes an alternative time slot to the family
        const counterDate = parseDateOnly(dto.counterDate);
        const counterTime = parseTimeToDate(dto.counterTime);

        const updated = await session.updateEncounter(encounterId, {
          proposedDate: counterDate,
          proposedTime: counterTime,
          proposedBy: 'DOCTOR',
          rescheduleReason: dto.notes ?? 'Bác sĩ đề xuất khung giờ thay thế',
        });

        await session.createAuditLog(actor.id, 'DOCTOR_PROPOSE_ALTERNATIVE_SLOT', encounterId);

        await session.createNotification({
          userId: encounter.contract.familyUnit.representativeUserId,
          title: 'Bác sĩ đề xuất khung giờ khám thay thế',
          content: `Bác sĩ bận vào giờ bạn chọn và đề xuất chuyển sang ngày ${dto.counterDate} lúc ${dto.counterTime}. Vui lòng xem xét lại lịch.`,
          type: 'ENCOUNTER_DOCTOR_COUNTER_OFFER',
          referenceId: encounter.id,
        });

        return updated;
      }

      // Doctor rejects and no suitable alternative slot is available
      await session.updateEncounter(encounterId, {
        proposedDate: null,
        proposedTime: null,
        proposedBy: null,
      });

      await session.createAuditLog(actor.id, 'DOCTOR_REJECT_RESCHEDULE_NO_SLOT', encounterId);

      await session.createNotification({
        userId: encounter.contract.familyUnit.representativeUserId,
        title: 'Không có khung giờ thay thế phù hợp',
        content: `Bác sĩ không thể bố trí khung giờ này và hiện không có slot trống phù hợp. Vui lòng chọn thời gian khác hoặc liên hệ hotline.`,
        type: 'RESCHEDULE_NO_SLOT_AVAILABLE',
        referenceId: encounter.id,
      });

      return {
        status: 'NO_SUITABLE_SLOT',
        message: 'Notified the family that no suitable slot is available and asked them to choose another time',
      };
    });
  }

  async createDoctorShift(actor: AuthenticatedUser, dto: CreateDoctorShiftDto) {
    if (!['HEALTHCARE_FACILITY', 'ADMIN'].includes(actor.role)) {
      throw new ForbiddenException('Only the healthcare facility or admin can create duty shifts');
    }

    return this.repository.transaction(async (session) => {
      let facilityId: string;
      if (actor.role === 'HEALTHCARE_FACILITY') {
        const fac = await session.findFacilityByUserId(actor.id);
        if (!fac) throw new NotFoundException('Healthcare facility profile not found');
        facilityId = fac.id;
      } else {
        const doc = await session.findDoctorById(dto.doctorId);
        if (!doc) throw new NotFoundException('Doctor not found');
        facilityId = doc.facilityId;
      }

      const shiftDate = parseDateOnly(dto.shiftDate);
      const startTime = parseTimeToDate(dto.startTime);
      const endTime = parseTimeToDate(dto.endTime);

      if (getTimeWindowMinutes(startTime) >= getTimeWindowMinutes(endTime)) {
        throw new BadRequestException('Shift start time must be before end time');
      }

      const shift = await session.createDoctorShift({
        doctorId: dto.doctorId,
        facilityId,
        shiftDate,
        startTime,
        endTime,
        shiftType: dto.shiftType,
        notes: dto.notes ?? null,
      });

      await session.createAuditLog(actor.id, 'CREATE_DOCTOR_SHIFT', shift.id);
      return shift;
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

      const shifts = await session.findShiftsByFacility(facilityId, fDate, tDate);

      // Also get all encounters for doctors belonging to this facility
      const encounters = await session.findEncounters({
        doctor: { facilityId },
        ...(fDate || tDate
          ? {
              scheduledDate: {
                ...(fDate ? { gte: fDate } : {}),
                ...(tDate ? { lte: tDate } : {}),
              },
            }
          : {}),
      }, 0, 100);

      return {
        facilityId,
        dutyShifts: shifts,
        externalEncounters: encounters[0],
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

  // Conflict Checking Engine between Examination Schedules and Facility Duty Shifts
  private async checkDutyShiftConflicts(
    session: EncountersSession,
    doctorId: string,
    scheduledDate: Date,
    scheduledTime: Date,
    excludeEncounterId?: string,
  ): Promise<{ hasConflict: boolean; reason?: string }> {
    const encStartMin = getTimeWindowMinutes(scheduledTime);
    const encEndMin = encStartMin + APPOINTMENT_DURATION_MINUTES;

    // 1. Check conflicts with Healthcare Facility internal duty shifts
    const shifts = await session.findDoctorShifts(doctorId, scheduledDate);
    for (const shift of shifts) {
      const shiftStartMin = getTimeWindowMinutes(shift.startTime);
      const shiftEndMin = getTimeWindowMinutes(shift.endTime);

      if (encStartMin < shiftEndMin && encEndMin > shiftStartMin) {
        return {
          hasConflict: true,
          reason: `Trùng với ca trực ${shift.shiftType} tại CSYT (${shift.startTime.toISOString().slice(11, 16)} - ${shift.endTime.toISOString().slice(11, 16)})`,
        };
      }
    }

    // 2. Check conflicts with existing confirmed encounters of this doctor (Double booking)
    const otherEncounters = await session.findDoctorOverlappingEncounters(
      doctorId,
      scheduledDate,
      excludeEncounterId,
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
