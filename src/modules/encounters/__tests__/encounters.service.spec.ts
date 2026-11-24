import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { EncounterCategory, EncounterStatus, EncounterType } from '@prisma/client';
import {
  EncountersServiceImpl,
  calculateCadenceDates,
  combineDateAndTime,
  getTimeWindowMinutes,
  parseDateOnly,
  parseTimeToDate,
} from '../services/impl/encounters.service.impl';
import { serializeEncounterScheduleMeta } from '../utils/encounter-schedule-meta.util';
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
      familyUnit: { representativeUserId: 'user-family-1', representativeUser: { fullName: 'Gia dinh 1' } },
      facility: { user: { id: 'user-facility-1' } },
      doctor: { user: { id: 'user-doctor-1' } },
    },
    participants: [{ patient: { id: 'patient-1', fullName: 'Nguyen Van Patient' } }],
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
      holdTelehealthQuota: jest.fn().mockResolvedValue(undefined),
      releaseTelehealthQuota: jest.fn().mockResolvedValue(undefined),
      consumeHeldTelehealthQuota: jest.fn().mockResolvedValue(undefined),
      findDoctorOverlappingEncounters: jest.fn().mockResolvedValue([]),
      findPendingRescheduleRequestByEncounter: jest.fn().mockResolvedValue(null),
      findRescheduleRequestById: jest.fn().mockResolvedValue(null),
      createRescheduleRequest: jest.fn().mockImplementation((data) => Promise.resolve({ id: 'req-1', ...data })),
      updateRescheduleRequest: jest.fn().mockImplementation((id, data) => Promise.resolve({ id, ...data })),
      findPendingRescheduleRequests: jest.fn().mockResolvedValue([]),
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
          encounterType: EncounterType.HOME_VISIT,
          category: EncounterCategory.PERIODIC_ROUTINE,
          encounterStatus: EncounterStatus.REQUESTED,
          visitScope: 'INDIVIDUAL',
          participants: { create: [{ patientId: 'patient-1' }] },
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
        }),
      );
      expect(mockSession.createNotifications).toHaveBeenCalled();
      expect((res as any).encounterStatus).toBe(EncounterStatus.CONFIRMED);
    });

    it('TC-U04: Overlaps with another confirmed appointment (Double booking) -> throws ConflictException', async () => {
      (mockSession.findDoctorOverlappingEncounters as jest.Mock).mockResolvedValueOnce([
        {
          id: 'other-encounter-2',
          scheduledTime: new Date('1970-01-01T09:15:00.000Z'),
        },
      ]);

      await expect(
        service.confirmEncounter(familyActor, 'encounter-1', { confirmed: true }),
      ).rejects.toThrow(ConflictException);
      expect(mockSession.decrementContractQuota).not.toHaveBeenCalled();
    });

    it('Fails if encounter is still in CADENCE_DRAFT (not finalized by doctor)', async () => {
      (mockSession.findEncounter as jest.Mock).mockResolvedValueOnce({
        ...sampleEncounter,
        encounterStatus: EncounterStatus.REQUESTED,
        cancelReason: serializeEncounterScheduleMeta(
          { stage: 'CADENCE_DRAFT', milestoneIndex: 1, totalMilestones: 4 },
          'Khung dự thảo',
        ),
      });

      await expect(
        service.confirmEncounter(familyActor, 'encounter-1', { confirmed: true }),
      ).rejects.toThrow(BadRequestException);
      expect(mockSession.decrementContractQuota).not.toHaveBeenCalled();
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
      const twoHoursAhead = new Date(Date.now() + 2 * 3600_000);
      (mockSession.findEncounter as jest.Mock).mockResolvedValueOnce({
        ...sampleEncounter,
        encounterStatus: EncounterStatus.CONFIRMED,
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

    it('TC-H03: Family creates reschedule request when >= 4 hours -> auto approves family & facility informational, pending doctor', async () => {
      const tomorrow = new Date(Date.now() + 24 * 3600_000);
      (mockSession.findEncounter as jest.Mock).mockResolvedValueOnce({
        ...sampleEncounter,
        encounterStatus: EncounterStatus.CONFIRMED,
        scheduledDate: tomorrow,
        scheduledTime: tomorrow,
      });

      const res: any = await service.requestReschedule(familyActor, 'encounter-1', {
        proposedDate: '2026-12-05',
        proposedTime: '14:00:00',
        rescheduleReason: 'Cần dời sang chiều',
      });

      expect(mockSession.createRescheduleRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          requestedByRole: 'FAMILY_REP',
          familyDecision: 'APPROVED',
          doctorDecision: 'PENDING',
          facilityDecision: 'PENDING',
          status: 'PENDING',
        }),
      );
      expect(mockSession.createNotifications).toHaveBeenCalled();
      expect(res.status).toBe('PENDING');
    });

    it('Doctor creates reschedule request -> auto approves doctor, pending family', async () => {
      const tomorrow = new Date(Date.now() + 24 * 3600_000);
      (mockSession.findEncounter as jest.Mock).mockResolvedValueOnce({
        ...sampleEncounter,
        encounterStatus: EncounterStatus.CONFIRMED,
        scheduledDate: tomorrow,
        scheduledTime: tomorrow,
      });

      const res: any = await service.requestReschedule(doctorActor, 'encounter-1', {
        proposedDate: '2026-12-07',
        proposedTime: '10:30:00',
        rescheduleReason: 'Bác sĩ kẹt lịch trực cấp cứu',
      });

      expect(mockSession.createRescheduleRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          requestedByRole: 'DOCTOR',
          doctorDecision: 'APPROVED',
          familyDecision: 'PENDING',
          facilityDecision: 'PENDING',
          status: 'PENDING',
        }),
      );
      expect(res.status).toBe('PENDING');
    });

    it('TC-U08: Allows reschedule request when reschedule count >= 3 (BR-4: unlimited reschedules)', async () => {
      (mockSession.findEncounter as jest.Mock).mockResolvedValueOnce({
        ...sampleEncounter,
        encounterStatus: EncounterStatus.CONFIRMED,
        rescheduleCount: 3,
        scheduledDate: new Date(Date.now() + 24 * 3600_000),
      });

      const res: any = await service.requestReschedule(familyActor, 'encounter-1', {
        proposedDate: '2026-12-05',
        proposedTime: '10:00:00',
        rescheduleReason: 'Đổi lần thứ 4',
      });
      expect(res.status).toBe('PENDING');
    });
  });

  describe('7. Bilateral Reschedule Decisions (2-Party Consensus + Facility Sync)', () => {
    it('Family request: Doctor approves -> immediately updates Encounter, sets APPROVED & notifies 3 parties', async () => {
      (mockSession.findEncounter as jest.Mock).mockResolvedValueOnce({
        ...sampleEncounter,
        encounterStatus: EncounterStatus.CONFIRMED,
      });
      (mockSession.findRescheduleRequestById as jest.Mock).mockResolvedValueOnce({
        id: 'req-1',
        encounterId: 'encounter-1',
        requestedByRole: 'FAMILY_REP',
        proposedDate: new Date('2026-12-05T00:00:00.000Z'),
        proposedTime: new Date('1970-01-01T14:00:00.000Z'),
        familyDecision: 'APPROVED',
        doctorDecision: 'PENDING',
        facilityDecision: 'APPROVED',
        status: 'PENDING',
      });

      const finalRes: any = await service.decideRescheduleRequest(doctorActor, 'encounter-1', 'req-1', {
        decision: 'APPROVE',
      });

      expect(finalRes.status).toBe('APPROVED');
      expect(mockSession.updateEncounter).toHaveBeenCalledWith(
        'encounter-1',
        expect.objectContaining({
          scheduledDate: new Date('2026-12-05T00:00:00.000Z'),
          scheduledTime: new Date('1970-01-01T14:00:00.000Z'),
          rescheduleCount: { increment: 1 },
          reminder24hSentAt: null,
          reminder2hSentAt: null,
        }),
      );
      expect(mockSession.createNotifications).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ userId: 'user-family-1', type: 'ENCOUNTER_RESCHEDULE_APPROVED' }),
          expect.objectContaining({ userId: 'user-doctor-1', type: 'ENCOUNTER_RESCHEDULE_APPROVED' }),
          expect.objectContaining({ userId: 'user-facility-1', type: 'ENCOUNTER_RESCHEDULE_APPROVED' }),
        ]),
      );
    });

    it('Doctor request: Family approves -> immediately updates Encounter & notifies 3 parties', async () => {
      (mockSession.findEncounter as jest.Mock).mockResolvedValueOnce({
        ...sampleEncounter,
        encounterStatus: EncounterStatus.CONFIRMED,
      });
      (mockSession.findRescheduleRequestById as jest.Mock).mockResolvedValueOnce({
        id: 'req-2',
        encounterId: 'encounter-1',
        requestedByRole: 'DOCTOR',
        proposedDate: new Date('2026-12-06T00:00:00.000Z'),
        proposedTime: new Date('1970-01-01T10:30:00.000Z'),
        familyDecision: 'PENDING',
        doctorDecision: 'APPROVED',
        facilityDecision: 'APPROVED',
        status: 'PENDING',
      });

      const finalRes: any = await service.decideRescheduleRequest(familyActor, 'encounter-1', 'req-2', {
        decision: 'APPROVE',
      });

      expect(finalRes.status).toBe('APPROVED');
      expect(mockSession.updateEncounter).toHaveBeenCalledWith(
        'encounter-1',
        expect.objectContaining({
          scheduledDate: new Date('2026-12-06T00:00:00.000Z'),
          scheduledTime: new Date('1970-01-01T10:30:00.000Z'),
          rescheduleCount: { increment: 1 },
        }),
      );
    });

    it('Responding party rejects -> request REJECTED, original CONFIRMED encounter untouched', async () => {
      (mockSession.findEncounter as jest.Mock).mockResolvedValueOnce({
        ...sampleEncounter,
        encounterStatus: EncounterStatus.CONFIRMED,
      });
      (mockSession.findRescheduleRequestById as jest.Mock).mockResolvedValueOnce({
        id: 'req-1',
        encounterId: 'encounter-1',
        requestedByRole: 'DOCTOR',
        proposedDate: new Date('2026-12-05T00:00:00.000Z'),
        proposedTime: new Date('1970-01-01T14:00:00.000Z'),
        familyDecision: 'PENDING',
        doctorDecision: 'APPROVED',
        facilityDecision: 'APPROVED',
        status: 'PENDING',
      });

      const res: any = await service.decideRescheduleRequest(familyActor, 'encounter-1', 'req-1', {
        decision: 'REJECT',
        note: 'Gia đình không rảnh giờ đó',
      });

      expect(res.status).toBe('REJECTED');
      expect(mockSession.updateEncounter).not.toHaveBeenCalled();
      expect(mockSession.createNotifications).toHaveBeenCalled();
    });

    it('Healthcare facility attempting to decide bilateral reschedule -> throws 403 ForbiddenException', async () => {
      await expect(
        service.decideRescheduleRequest(facilityActor, 'encounter-1', 'req-1', {
          decision: 'APPROVE',
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('8. Timetable & Schedule Board Queries', () => {
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

    it('Facility queries schedule board successfully (platform encounters & pending reschedules)', async () => {
      const res: any = await service.getFacilityScheduleBoard(facilityActor);
      expect(res.facilityId).toBe('facility-1');
      expect(res.encounters).toBeDefined();
      expect(res.pendingRescheduleRequests).toBeDefined();
    });
  });

  describe('Periodic Cadence Scheduling & Doctor Review', () => {
    it('calculateCadenceDates calculates evenly spaced milestones', () => {
      const start = new Date('2026-01-01T00:00:00.000Z');
      const dates = calculateCadenceDates(start, 12, 4);
      expect(dates).toHaveLength(4);
      // First milestone: 1 month after activation (February)
      expect(dates[0].getUTCMonth()).toBe(1);
      // Last milestone later than preceding
      expect(dates[3].getTime()).toBeGreaterThan(dates[2].getTime());
    });

    it('generateContractPeriodicCadence generates draft encounters for active contract', async () => {
      const activeContract = {
        ...sampleContract,
        startDate: new Date('2026-01-01T00:00:00.000Z'),
        servicePackage: { durationMonths: 12, periodicVisitsQuota: 4 },
        members: [{ patientId: 'patient-1' }],
        doctor: { user: { id: 'user-doctor-1' } },
        contractNumber: 'HD-2026-001',
      };
      (mockSession.findContract as jest.Mock).mockResolvedValueOnce(activeContract);
      (mockSession.findEncounters as jest.Mock).mockResolvedValueOnce([[], 0]);
      (mockSession.findDoctorOverlappingEncounters as jest.Mock).mockResolvedValue([]);
      (mockSession.createEncounter as jest.Mock).mockImplementation((data) =>
        Promise.resolve({ id: `enc-${Math.random()}`, ...data }),
      );

      const result = await service.generateContractPeriodicCadence('contract-1');
      expect(result.generatedCount).toBe(4);
      expect(mockSession.createEncounter).toHaveBeenCalledTimes(4);
      expect(mockSession.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-doctor-1',
          title: expect.stringContaining('Khung lịch khám định kỳ mới'),
        }),
      );
    });

    it('generateContractPeriodicCadence returns existing encounters if already generated (idempotent)', async () => {
      (mockSession.findContract as jest.Mock).mockResolvedValueOnce({
        ...sampleContract,
        servicePackage: { durationMonths: 12, periodicVisitsQuota: 4 },
      });
      (mockSession.findEncounters as jest.Mock).mockResolvedValueOnce([[sampleEncounter], 1]);

      const result = await service.generateContractPeriodicCadence('contract-1');
      expect(result.generatedCount).toBe(0);
      expect(result.encounters).toHaveLength(1);
      expect(mockSession.createEncounter).not.toHaveBeenCalled();
    });

    it('finalizeCadenceSchedule transitions CADENCE_DRAFT milestones to AWAITING_FAMILY_CONFIRM and notifies family', async () => {
      const draftEnc = {
        ...sampleEncounter,
        id: 'draft-1',
        encounterStatus: EncounterStatus.REQUESTED,
        cancelReason: serializeEncounterScheduleMeta(
          { stage: 'CADENCE_DRAFT', milestoneIndex: 1, totalMilestones: 4 },
          'Khám định kỳ lần 1/4',
        ),
      };
      (mockSession.findContract as jest.Mock).mockResolvedValueOnce({
        ...sampleContract,
        familyUnit: { representativeUserId: 'user-family-1', representativeUser: { id: 'user-family-1' } },
        doctor: { user: { fullName: 'BS Nguyễn Văn A' } },
      });
      (mockSession.findDoctorByUserId as jest.Mock).mockResolvedValueOnce({
        id: 'doctor-1',
        userId: 'user-doctor-1',
      });
      (mockSession.findEncounters as jest.Mock).mockResolvedValueOnce([[draftEnc], 1]);
      (mockSession.updateEncounter as jest.Mock).mockImplementationOnce((_id, data) =>
        Promise.resolve({ ...draftEnc, ...data }),
      );

      const res: any = await service.finalizeCadenceSchedule(doctorActor, 'contract-1');
      expect(res.finalizedCount).toBe(1);
      expect(res.encounters[0].scheduleStage).toBe('AWAITING_FAMILY_CONFIRM');
      expect(res.encounters[0].milestoneIndex).toBe(1);
      expect(res.encounters[0].totalMilestones).toBe(4);
      expect(mockSession.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-family-1',
          title: expect.stringContaining('chốt kế hoạch khám định kỳ'),
        }),
      );
    });

    it('confirmCadenceSchedule bulk-confirms all AWAITING_FAMILY_CONFIRM milestones and deducts quota', async () => {
      const finalizedEncs = [1, 2].map((idx) => ({
        ...sampleEncounter,
        id: `fin-${idx}`,
        scheduledDate: new Date(`2026-0${idx + 2}-10T00:00:00.000Z`),
        scheduledTime: new Date('1970-01-01T08:30:00.000Z'),
        encounterStatus: EncounterStatus.REQUESTED,
        cancelReason: serializeEncounterScheduleMeta(
          { stage: 'AWAITING_FAMILY_CONFIRM', milestoneIndex: idx, totalMilestones: 2 },
          'Bác sĩ đã chốt',
        ),
      }));
      (mockSession.findContract as jest.Mock).mockResolvedValueOnce({
        ...sampleContract,
        remainingHomeVisits: 4,
      });
      (mockSession.findEncounters as jest.Mock).mockResolvedValueOnce([finalizedEncs, 2]);
      (mockSession.updateEncounter as jest.Mock).mockImplementation((id, data) =>
        Promise.resolve({ ...finalizedEncs.find((e) => e.id === id), ...data }),
      );

      const res: any = await service.confirmCadenceSchedule(familyActor, 'contract-1');
      expect(res.confirmedCount).toBe(2);
      expect(mockSession.decrementContractQuota).toHaveBeenCalledTimes(2);
      expect(mockSession.createNotifications).toHaveBeenCalled();
    });

    it('adjustCadenceMilestone updates CADENCE_DRAFT date/time and rejects conflicting slots', async () => {
      const draftEnc = {
        ...sampleEncounter,
        encounterStatus: EncounterStatus.REQUESTED,
        cancelReason: serializeEncounterScheduleMeta(
          { stage: 'CADENCE_DRAFT', milestoneIndex: 1, totalMilestones: 4 },
          'Khung dự thảo',
        ),
      };
      (mockSession.findEncounter as jest.Mock).mockResolvedValueOnce(draftEnc);
      (mockSession.findDoctorByUserId as jest.Mock).mockResolvedValueOnce({
        id: 'doctor-1',
        userId: 'user-doctor-1',
      });
      (mockSession.findDoctorOverlappingEncounters as jest.Mock).mockResolvedValueOnce([]);
      (mockSession.updateEncounter as jest.Mock).mockImplementationOnce((_id, data) =>
        Promise.resolve({ ...draftEnc, ...data }),
      );

      const res: any = await service.adjustCadenceMilestone(doctorActor, 'encounter-1', {
        scheduledDate: '2026-06-15',
        scheduledTime: '10:30:00',
      });

      expect(res.scheduleStage).toBe('CADENCE_DRAFT');
      expect(mockSession.updateEncounter).toHaveBeenCalledWith(
        'encounter-1',
        expect.objectContaining({
          scheduledDate: new Date(Date.UTC(2026, 5, 15)),
          scheduledTime: new Date(Date.UTC(1970, 0, 1, 10, 30, 0)),
        }),
      );

      // Now test overlapping conflict -> throws ConflictException
      (mockSession.findEncounter as jest.Mock).mockResolvedValueOnce(draftEnc);
      (mockSession.findDoctorByUserId as jest.Mock).mockResolvedValueOnce({
        id: 'doctor-1',
        userId: 'user-doctor-1',
      });
      (mockSession.findDoctorOverlappingEncounters as jest.Mock).mockResolvedValueOnce([
        { id: 'other-enc', scheduledTime: new Date('1970-01-01T10:30:00.000Z') },
      ]);

      await expect(
        service.adjustCadenceMilestone(doctorActor, 'encounter-1', {
          scheduledDate: '2026-06-15',
          scheduledTime: '10:30:00',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });
});
