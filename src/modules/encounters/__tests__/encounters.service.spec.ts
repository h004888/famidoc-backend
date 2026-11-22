import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { EncounterCategory, EncounterStatus, EncounterType } from '@prisma/client';
import {
  EncountersServiceImpl,
  combineDateAndTime,
  getTimeWindowMinutes,
  parseDateOnly,
  parseTimeToDate,
} from '../services/impl/encounters.service.impl';
import type {
  EncountersSession,
  IEncountersRepository,
} from '../repositories/interfaces/encounters.repository.interface';
import type { AuthenticatedUser } from '../../../core/auth/authenticated-request';

describe('EncountersService (Main Business Flow 2.3)', () => {
  let service: EncountersServiceImpl;
  let mockSession: Partial<jest.Mocked<EncountersSession>>;
  let mockRepository: jest.Mocked<IEncountersRepository>;

  const doctorActor: AuthenticatedUser = {
    id: 'user-doctor-1',
    role: 'DOCTOR',
    familyUnitId: null,
  };

  const familyActor: AuthenticatedUser = {
    id: 'user-family-1',
    role: 'FAMILY_REP',
    familyUnitId: 'fam-unit-1',
  };

  const facilityActor: AuthenticatedUser = {
    id: 'user-facility-1',
    role: 'HEALTHCARE_FACILITY',
    familyUnitId: null,
  };

  const sampleContract = {
    id: 'contract-1',
    contractStatus: 'ACTIVE',
    doctorId: 'doctor-1',
    remainingHomeVisits: 3,
    remainingTelehealth: 5,
    familyUnit: {
      representativeUserId: 'user-family-1',
    },
    facility: {
      userId: 'user-facility-1',
    },
    doctor: {
      id: 'doctor-1',
      userId: 'user-doctor-1',
      doctorName: 'BS Nguyen Van A',
      user: { id: 'user-doctor-1' },
    },
  };

  const sampleEncounter = {
    id: 'encounter-1',
    contractId: 'contract-1',
    patientId: 'patient-1',
    doctorId: 'doctor-1',
    encounterType: EncounterType.HOME_VISIT,
    category: EncounterCategory.PERIODIC_ROUTINE,
    scheduledDate: new Date('2026-12-01T00:00:00.000Z'),
    scheduledTime: new Date('1970-01-01T09:00:00.000Z'),
    rescheduleCount: 0,
    encounterStatus: EncounterStatus.REQUESTED,
    proposedDate: null,
    proposedTime: null,
    proposedBy: null,
    rescheduleReason: null,
    conflictAlert: false,
    conflictDetails: null,
    contract: {
      id: 'contract-1',
      familyId: 'fam-unit-1',
      facilityId: 'facility-1',
      familyUnit: { representativeUserId: 'user-family-1' },
      facility: { user: { id: 'user-facility-1' } },
      doctor: { user: { id: 'user-doctor-1' } },
    },
    patient: { id: 'patient-1', fullName: 'Nguyen Van Patient' },
    doctor: {
      id: 'doctor-1',
      doctorName: 'BS Nguyen Van A',
      user: { id: 'user-doctor-1' },
    },
  };

  beforeEach(() => {
    mockSession = {
      findContract: jest.fn().mockResolvedValue(sampleContract as any),
      isPatientInContract: jest.fn().mockResolvedValue(true),
      findDoctorByUserId: jest.fn().mockResolvedValue({ id: 'doctor-1', facilityId: 'facility-1' } as any),
      findDoctorById: jest.fn().mockResolvedValue({ id: 'doctor-1', facilityId: 'facility-1' } as any),
      findFacilityByUserId: jest.fn().mockResolvedValue({ id: 'facility-1' } as any),
      createEncounter: jest.fn().mockResolvedValue(sampleEncounter as any),
      findEncounter: jest.fn().mockResolvedValue(sampleEncounter as any),
      updateEncounter: jest.fn().mockImplementation((id, data) =>
        Promise.resolve({ ...sampleEncounter, ...data }),
      ),
      decrementContractQuota: jest.fn().mockResolvedValue(undefined),
      findDoctorShifts: jest.fn().mockResolvedValue([]),
      findDoctorOverlappingEncounters: jest.fn().mockResolvedValue([]),
      createDoctorShift: jest.fn().mockImplementation((data) => Promise.resolve({ id: 'shift-1', ...data })),
      findShiftsByFacility: jest.fn().mockResolvedValue([]),
      findEncounters: jest.fn().mockResolvedValue([[sampleEncounter as any], 1]),
      createNotification: jest.fn().mockResolvedValue(undefined),
      createNotifications: jest.fn().mockResolvedValue(undefined),
      createAuditLog: jest.fn().mockResolvedValue(undefined),
    };

    mockRepository = {
      transaction: jest.fn().mockImplementation((work) => work(mockSession as any)),
    };

    service = new EncountersServiceImpl(mockRepository);
  });

  describe('1. Date & Time Helpers', () => {
    it('parses valid date and time correctly', () => {
      const d = parseDateOnly('2026-11-20');
      expect(d.getUTCFullYear()).toBe(2026);
      expect(d.getUTCMonth()).toBe(10);
      expect(d.getUTCDate()).toBe(20);

      const t = parseTimeToDate('09:30:00');
      expect(t.getUTCHours()).toBe(9);
      expect(t.getUTCMinutes()).toBe(30);

      const combined = combineDateAndTime(d, t);
      expect(combined.getUTCFullYear()).toBe(2026);
      expect(combined.getUTCHours()).toBe(9);
      expect(getTimeWindowMinutes(t)).toBe(9 * 60 + 30);
    });

    it('throws BadRequestException for invalid date or time', () => {
      expect(() => parseDateOnly('2026/11/20')).toThrow(BadRequestException);
      expect(() => parseTimeToDate('99:99')).toThrow(BadRequestException);
    });
  });

  describe('2. Periodic Encounter Planning (TC-H01 & Unhappy Cases)', () => {
    it('TC-H01: Doctor plans periodic encounter successfully', async () => {
      const res = await service.createPeriodicEncounter(doctorActor, {
        contractId: 'contract-1',
        patientId: 'patient-1',
        encounterType: EncounterType.HOME_VISIT,
        scheduledDate: '2026-12-01',
        scheduledTime: '09:00:00',
        notes: 'Khám định kỳ tổng quát',
      });

      expect(mockSession.createEncounter).toHaveBeenCalledWith(
        expect.objectContaining({
          contractId: 'contract-1',
          patientId: 'patient-1',
          encounterType: EncounterType.HOME_VISIT,
          category: EncounterCategory.PERIODIC_ROUTINE,
          encounterStatus: EncounterStatus.REQUESTED,
        }),
      );
      expect(mockSession.createNotification).toHaveBeenCalled();
      expect(res).toBeDefined();
    });

    it('TC-U05: Fails when home visit quota is exhausted', async () => {
      (mockSession.findContract as jest.Mock).mockResolvedValueOnce({
        ...sampleContract,
        remainingHomeVisits: 0,
      });

      await expect(
        service.createPeriodicEncounter(doctorActor, {
          contractId: 'contract-1',
          patientId: 'patient-1',
          encounterType: EncounterType.HOME_VISIT,
          scheduledDate: '2026-12-01',
          scheduledTime: '09:00:00',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('TC-U06: Fails when contract is not active', async () => {
      (mockSession.findContract as jest.Mock).mockResolvedValueOnce({
        ...sampleContract,
        contractStatus: 'TERMINATED',
      });

      await expect(
        service.createPeriodicEncounter(doctorActor, {
          contractId: 'contract-1',
          patientId: 'patient-1',
          encounterType: EncounterType.HOME_VISIT,
          scheduledDate: '2026-12-01',
          scheduledTime: '09:00:00',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('TC-U07: Fails when patient is not a covered contract member', async () => {
      (mockSession.isPatientInContract as jest.Mock).mockResolvedValueOnce(false);

      await expect(
        service.createPeriodicEncounter(doctorActor, {
          contractId: 'contract-1',
          patientId: 'patient-unknown',
          encounterType: EncounterType.HOME_VISIT,
          scheduledDate: '2026-12-01',
          scheduledTime: '09:00:00',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('Fails when non-doctor/non-admin attempts to plan periodic roadmap', async () => {
      await expect(
        service.createPeriodicEncounter(familyActor, {
          contractId: 'contract-1',
          patientId: 'patient-1',
          encounterType: EncounterType.HOME_VISIT,
          scheduledDate: '2026-12-01',
          scheduledTime: '09:00:00',
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('3. Ad-hoc Encounter Request (TC-H02)', () => {
    it('TC-H02: Family submits ad-hoc request successfully', async () => {
      const res = await service.createAdHocEncounter(familyActor, {
        contractId: 'contract-1',
        patientId: 'patient-1',
        encounterType: EncounterType.TELEHEALTH,
        desiredDate: '2026-11-20',
        desiredTime: '14:00:00',
        reason: 'Sốt cao cần tư vấn gấp',
      });

      expect(mockSession.createEncounter).toHaveBeenCalledWith(
        expect.objectContaining({
          category: EncounterCategory.AD_HOC_ON_DEMAND,
          encounterStatus: EncounterStatus.REQUESTED,
        }),
      );
      expect(res).toBeDefined();
    });

    it('Fails if actor is not the family representative', async () => {
      await expect(
        service.createAdHocEncounter(doctorActor, {
          contractId: 'contract-1',
          patientId: 'patient-1',
          encounterType: EncounterType.TELEHEALTH,
          desiredDate: '2026-11-20',
          desiredTime: '14:00:00',
          reason: 'Reason',
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('4. Finalize Schedule by Doctor', () => {
    it('Doctor finalizes proposed schedule and notifies family', async () => {
      const res = await service.finalizeEncounter(doctorActor, 'encounter-1', {
        scheduledDate: '2026-12-02',
        scheduledTime: '10:00:00',
        doctorNotes: 'Bác sĩ đã chốt giờ khám tại nhà',
      });

      expect(mockSession.updateEncounter).toHaveBeenCalled();
      expect(mockSession.createNotification).toHaveBeenCalled();
      expect(res).toBeDefined();
    });
  });

  describe('5. Confirmation & Duty Shift Conflict Checking (TC-H01 & TC-U03 & TC-U04)', () => {
    it('TC-H01: Family confirms schedule without conflict -> Confirmed and quota decremented', async () => {
      const res = await service.confirmEncounter(familyActor, 'encounter-1', { confirmed: true });

      expect(mockSession.decrementContractQuota).toHaveBeenCalledWith('contract-1', EncounterType.HOME_VISIT);
      expect(mockSession.updateEncounter).toHaveBeenCalledWith(
        'encounter-1',
        expect.objectContaining({
          encounterStatus: EncounterStatus.CONFIRMED,
          conflictAlert: false,
          conflictDetails: null,
        }),
      );
      expect(mockSession.createNotifications).toHaveBeenCalled();
      expect((res as any).encounterStatus).toBe(EncounterStatus.CONFIRMED);
    });

    it('TC-U03: Overlaps with Healthcare Facility internal duty shift -> triggers Conflict Alert', async () => {
      // Mock existing shift at facility from 08:00 to 12:00
      (mockSession.findDoctorShifts as jest.Mock).mockResolvedValueOnce([
        {
          id: 'shift-1',
          doctorId: 'doctor-1',
          shiftDate: new Date('2026-12-01T00:00:00.000Z'),
          startTime: new Date('1970-01-01T08:00:00.000Z'),
          endTime: new Date('1970-01-01T12:00:00.000Z'),
          shiftType: 'MORNING_CLINIC',
        },
      ]);

      const res: any = await service.confirmEncounter(familyActor, 'encounter-1', { confirmed: true });

      expect(res.status).toBe('CONFLICT_ALERT');
      expect(res.conflictDetails).toContain('MORNING_CLINIC');
      expect(mockSession.decrementContractQuota).not.toHaveBeenCalled();
      expect(mockSession.createNotification).toHaveBeenCalled(); // Alert to doctor and facility
    });

    it('TC-U04: Overlaps with another confirmed appointment (Double booking) -> triggers Conflict Alert', async () => {
      (mockSession.findDoctorOverlappingEncounters as jest.Mock).mockResolvedValueOnce([
        {
          id: 'other-encounter-2',
          scheduledTime: new Date('1970-01-01T09:15:00.000Z'),
        },
      ]);

      const res: any = await service.confirmEncounter(familyActor, 'encounter-1', { confirmed: true });

      expect(res.status).toBe('CONFLICT_ALERT');
      expect(res.conflictDetails).toContain('Trùng với một lịch khám đã xác nhận khác');
    });

    it('Fails if encounter is already confirmed', async () => {
      (mockSession.findEncounter as jest.Mock).mockResolvedValueOnce({
        ...sampleEncounter,
        encounterStatus: EncounterStatus.CONFIRMED,
      });

      await expect(
        service.confirmEncounter(familyActor, 'encounter-1', { confirmed: true }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('6. Rescheduling & 4-Hour SLA Rule (TC-H03 & TC-U01 & TC-U08)', () => {
    it('TC-U01: Rejects reschedule request when remaining time < 4 hours', async () => {
      // Appointment in 2 hours
      const twoHoursAhead = new Date(Date.now() + 2 * 3600_000);
      (mockSession.findEncounter as jest.Mock).mockResolvedValueOnce({
        ...sampleEncounter,
        scheduledDate: twoHoursAhead,
        scheduledTime: twoHoursAhead,
      });

      await expect(
        service.requestReschedule(familyActor, 'encounter-1', {
          proposedDate: '2026-12-05',
          proposedTime: '10:00:00',
          rescheduleReason: 'Gia đình bận',
        }),
      ).rejects.toThrow(BadRequestException);

      expect(mockSession.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'RESCHEDULE_REJECTED_UNDER_4H',
        }),
      );
    });

    it('TC-H03: Accepts reschedule request when remaining time >= 4 hours', async () => {
      // Appointment in 24 hours
      const tomorrow = new Date(Date.now() + 24 * 3600_000);
      (mockSession.findEncounter as jest.Mock).mockResolvedValueOnce({
        ...sampleEncounter,
        scheduledDate: tomorrow,
        scheduledTime: tomorrow,
      });

      const res = await service.requestReschedule(familyActor, 'encounter-1', {
        proposedDate: '2026-12-05',
        proposedTime: '14:00:00',
        rescheduleReason: 'Cần dời sang chiều',
      });

      expect(mockSession.updateEncounter).toHaveBeenCalledWith('encounter-1', {
        proposedDate: expect.any(Date),
        proposedTime: expect.any(Date),
        proposedBy: 'FAMILY_REP',
        rescheduleReason: 'Cần dời sang chiều',
        rescheduleCount: { increment: 1 },
      });
      expect(res).toBeDefined();
    });

    it('TC-U08: Rejects when reschedule count exceeds maximum limit (>= 3)', async () => {
      (mockSession.findEncounter as jest.Mock).mockResolvedValueOnce({
        ...sampleEncounter,
        rescheduleCount: 3,
        scheduledDate: new Date(Date.now() + 24 * 3600_000),
      });

      await expect(
        service.requestReschedule(familyActor, 'encounter-1', {
          proposedDate: '2026-12-05',
          proposedTime: '10:00:00',
          rescheduleReason: 'Đổi lần thứ 4',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('7. Doctor Reschedule Review (TC-H03, TC-H04, TC-U02)', () => {
    it('TC-H03: Doctor accepts family proposed schedule', async () => {
      (mockSession.findEncounter as jest.Mock).mockResolvedValueOnce({
        ...sampleEncounter,
        proposedDate: new Date('2026-12-05T00:00:00.000Z'),
        proposedTime: new Date('1970-01-01T14:00:00.000Z'),
        proposedBy: 'FAMILY_REP',
      });

      const res = await service.reviewReschedule(doctorActor, 'encounter-1', {
        accept: true,
      });

      expect(mockSession.updateEncounter).toHaveBeenCalledWith(
        'encounter-1',
        expect.objectContaining({
          encounterStatus: EncounterStatus.CONFIRMED,
          proposedDate: null,
          proposedTime: null,
          proposedBy: null,
        }),
      );
      expect(mockSession.createNotification).toHaveBeenCalled();
      expect(res).toBeDefined();
    });

    it('TC-H04: Doctor counters with an alternative time slot', async () => {
      (mockSession.findEncounter as jest.Mock).mockResolvedValueOnce({
        ...sampleEncounter,
        proposedDate: new Date('2026-12-05T00:00:00.000Z'),
        proposedTime: new Date('1970-01-01T14:00:00.000Z'),
        proposedBy: 'FAMILY_REP',
      });

      const res = await service.reviewReschedule(doctorActor, 'encounter-1', {
        accept: false,
        counterDate: '2026-12-06',
        counterTime: '15:30:00',
        notes: 'Chiều 5/12 tôi bận, đổi sang chiều 6/12',
      });

      expect(mockSession.updateEncounter).toHaveBeenCalledWith('encounter-1', {
        proposedDate: expect.any(Date),
        proposedTime: expect.any(Date),
        proposedBy: 'DOCTOR',
        rescheduleReason: 'Chiều 5/12 tôi bận, đổi sang chiều 6/12',
      });
      expect(mockSession.createNotification).toHaveBeenCalled();
      expect(res).toBeDefined();
    });

    it('TC-U02: Doctor rejects and no suitable slot is available', async () => {
      (mockSession.findEncounter as jest.Mock).mockResolvedValueOnce({
        ...sampleEncounter,
        proposedDate: new Date('2026-12-05T00:00:00.000Z'),
        proposedTime: new Date('1970-01-01T14:00:00.000Z'),
        proposedBy: 'FAMILY_REP',
      });

      const res: any = await service.reviewReschedule(doctorActor, 'encounter-1', {
        accept: false,
      });

      expect(res.status).toBe('NO_SUITABLE_SLOT');
      expect(mockSession.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'RESCHEDULE_NO_SLOT_AVAILABLE',
        }),
      );
    });
  });

  describe('8. Healthcare Facility Duty Shifts Management', () => {
    it('Facility creates a duty shift successfully', async () => {
      const res = await service.createDoctorShift(facilityActor, {
        doctorId: 'doctor-1',
        shiftDate: '2026-11-25',
        startTime: '07:30:00',
        endTime: '11:30:00',
        shiftType: 'MORNING_CLINIC',
      });

      expect(mockSession.createDoctorShift).toHaveBeenCalled();
      expect(res).toBeDefined();
    });

    it('Fails when shift startTime is after endTime', async () => {
      await expect(
        service.createDoctorShift(facilityActor, {
          doctorId: 'doctor-1',
          shiftDate: '2026-11-25',
          startTime: '15:00:00',
          endTime: '08:00:00',
          shiftType: 'INVALID_SHIFT',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('9. Timetable & Schedule Board Queries', () => {
    it('Doctor queries timetable successfully', async () => {
      const res: any = await service.getDoctorTimetable(doctorActor, { page: 1, pageSize: 10 });
      expect(res.data).toHaveLength(1);
      expect(res.pagination.totalItems).toBe(1);
    });

    it('Family queries timetable successfully', async () => {
      const res: any = await service.getFamilyTimetable(familyActor, { page: 1, pageSize: 10 });
      expect(res.data).toHaveLength(1);
      expect(res.pagination.totalItems).toBe(1);
    });

    it('Facility queries schedule board successfully', async () => {
      const res: any = await service.getFacilityScheduleBoard(facilityActor);
      expect(res.facilityId).toBe('facility-1');
      expect(res.dutyShifts).toBeDefined();
      expect(res.externalEncounters).toBeDefined();
    });
  });

  describe('10. Turn Tracking & Doctor Counter-Offer Confirmation', () => {
    it('sets proposedBy = DOCTOR on createPeriodicEncounter and FAMILY_REP on createAdHocEncounter', async () => {
      await service.createPeriodicEncounter(doctorActor, {
        contractId: 'contract-1',
        patientId: 'patient-1',
        encounterType: EncounterType.HOME_VISIT,
        scheduledDate: '2026-12-10',
        scheduledTime: '09:00:00',
      });
      expect(mockSession.createEncounter).toHaveBeenCalledWith(
        expect.objectContaining({ proposedBy: 'DOCTOR', encounterStatus: EncounterStatus.REQUESTED }),
      );

      await service.createAdHocEncounter(familyActor, {
        contractId: 'contract-1',
        patientId: 'patient-1',
        encounterType: EncounterType.TELEHEALTH,
        desiredDate: '2026-12-12',
        desiredTime: '15:00:00',
        reason: 'Sốt nhẹ cần tư vấn',
      });
      expect(mockSession.createEncounter).toHaveBeenCalledWith(
        expect.objectContaining({
          proposedBy: 'FAMILY_REP',
          encounterStatus: EncounterStatus.REQUESTED,
        }),
      );
    });

    it('promotes proposedDate/proposedTime on confirmEncounter when proposedBy is DOCTOR', async () => {
      const counterDate = new Date('2026-12-06T00:00:00.000Z');
      const counterTime = new Date('1970-01-01T14:30:00.000Z');
      (mockSession.findEncounter as jest.Mock).mockResolvedValueOnce({
        ...sampleEncounter,
        proposedDate: counterDate,
        proposedTime: counterTime,
        proposedBy: 'DOCTOR',
      });

      await service.confirmEncounter(familyActor, 'encounter-1', { confirmed: true });

      expect(mockSession.updateEncounter).toHaveBeenCalledWith(
        'encounter-1',
        expect.objectContaining({
          scheduledDate: counterDate,
          scheduledTime: counterTime,
          proposedDate: null,
          proposedTime: null,
          proposedBy: null,
          encounterStatus: EncounterStatus.CONFIRMED,
        }),
      );
      expect(mockSession.decrementContractQuota).toHaveBeenCalledWith(
        'contract-1',
        EncounterType.HOME_VISIT,
      );
    });

    it('blocks confirmEncounter while encounter is awaiting doctor review (proposedBy = FAMILY_REP)', async () => {
      (mockSession.findEncounter as jest.Mock).mockResolvedValueOnce({
        ...sampleEncounter,
        proposedBy: 'FAMILY_REP',
      });

      await expect(
        service.confirmEncounter(familyActor, 'encounter-1', { confirmed: true }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
