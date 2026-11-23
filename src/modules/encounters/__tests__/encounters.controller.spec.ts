import { EncountersController } from '../controllers/encounters.controller';
import type { IEncountersService } from '../services/interfaces/encounters.service.interface';
import type { AuthenticatedRequest } from '../../../core/auth/authenticated-request';
import { EncounterType } from '@prisma/client';

describe('EncountersController', () => {
  let controller: EncountersController;
  let service: jest.Mocked<IEncountersService>;

  const mockRequest = (role: 'DOCTOR' | 'FAMILY_REP' | 'HEALTHCARE_FACILITY' | 'ADMIN', id = 'user-1'): AuthenticatedRequest =>
    ({
      user: {
        id,
        role,
        familyUnitId: role === 'FAMILY_REP' ? 'fam-1' : null,
      },
    }) as any;

  beforeEach(() => {
    service = {
      createPeriodicEncounter: jest.fn().mockResolvedValue({ id: 'enc-1' }),
      createAdHocEncounter: jest.fn().mockResolvedValue({ id: 'enc-2' }),
      finalizeEncounter: jest.fn().mockResolvedValue({ id: 'enc-1' }),
      confirmEncounter: jest.fn().mockResolvedValue({ id: 'enc-1' }),
      requestReschedule: jest.fn().mockResolvedValue({ id: 'req-1' }),
      decideRescheduleRequest: jest.fn().mockResolvedValue({ id: 'req-1' }),
      getPendingRescheduleRequests: jest.fn().mockResolvedValue([]),
      getDoctorTimetable: jest.fn().mockResolvedValue({ data: [], pagination: {} }),
      getFamilyTimetable: jest.fn().mockResolvedValue({ data: [], pagination: {} }),
      getFacilityScheduleBoard: jest.fn().mockResolvedValue({ encounters: [], pendingRescheduleRequests: [] }),
      getEncounterDetail: jest.fn().mockResolvedValue({ id: 'enc-1' }),
      generateContractPeriodicCadence: jest.fn().mockResolvedValue({ generatedCount: 4, encounters: [] }),
      finalizeCadenceSchedule: jest.fn().mockResolvedValue({ finalizedCount: 4, encounters: [] }),
      confirmCadenceSchedule: jest.fn().mockResolvedValue({ confirmedCount: 4, encounters: [] }),
      adjustCadenceMilestone: jest.fn().mockResolvedValue({ id: 'enc-1' }),
    };

    controller = new EncountersController(service);
  });

  it('delegates createPeriodicEncounter', async () => {
    const req = mockRequest('DOCTOR');
    const dto = {
      contractId: 'contract-1',
      patientId: 'patient-1',
      encounterType: EncounterType.HOME_VISIT,
      scheduledDate: '2026-12-01',
      scheduledTime: '09:00:00',
    };
    await controller.createPeriodicEncounter(req, dto);
    expect(service.createPeriodicEncounter).toHaveBeenCalledWith(req.user, dto);
  });

  it('delegates createAdHocEncounter', async () => {
    const req = mockRequest('FAMILY_REP');
    const dto = {
      contractId: 'contract-1',
      patientId: 'patient-1',
      encounterType: EncounterType.TELEHEALTH,
      desiredDate: '2026-11-20',
      desiredTime: '14:00:00',
      reason: 'Sốt cao',
    };
    await controller.createAdHocEncounter(req, dto);
    expect(service.createAdHocEncounter).toHaveBeenCalledWith(req.user, dto);
  });

  it('delegates finalizeEncounter', async () => {
    const req = mockRequest('DOCTOR');
    const dto = { scheduledDate: '2026-12-02' };
    await controller.finalizeEncounter(req, 'enc-1', dto);
    expect(service.finalizeEncounter).toHaveBeenCalledWith(req.user, 'enc-1', dto);
  });

  it('delegates confirmEncounter', async () => {
    const req = mockRequest('FAMILY_REP');
    const dto = { confirmed: true };
    await controller.confirmEncounter(req, 'enc-1', dto);
    expect(service.confirmEncounter).toHaveBeenCalledWith(req.user, 'enc-1', dto);
  });

  it('delegates requestReschedule', async () => {
    const req = mockRequest('FAMILY_REP');
    const dto = {
      proposedDate: '2026-12-05',
      proposedTime: '10:00:00',
      rescheduleReason: 'Gia đình bận',
    };
    await controller.requestReschedule(req, 'enc-1', dto);
    expect(service.requestReschedule).toHaveBeenCalledWith(req.user, 'enc-1', dto);
  });

  it('delegates decideRescheduleRequest and getPendingRescheduleRequests', async () => {
    const req = mockRequest('HEALTHCARE_FACILITY');
    const dto = { decision: 'APPROVE' as const, note: 'OK' };
    await controller.decideRescheduleRequest(req, 'enc-1', 'req-1', dto);
    expect(service.decideRescheduleRequest).toHaveBeenCalledWith(req.user, 'enc-1', 'req-1', dto);

    await controller.getPendingRescheduleRequests(req);
    expect(service.getPendingRescheduleRequests).toHaveBeenCalledWith(req.user);
  });

  it('delegates timetable and detail queries', async () => {
    const req = mockRequest('DOCTOR');
    await controller.getDoctorTimetable(req, { page: 1, pageSize: 20 });
    expect(service.getDoctorTimetable).toHaveBeenCalled();

    await controller.getEncounterDetail(req, 'enc-1');
    expect(service.getEncounterDetail).toHaveBeenCalledWith(req.user, 'enc-1');

    await controller.finalizeCadenceSchedule(req, 'contract-1');
    expect(service.finalizeCadenceSchedule).toHaveBeenCalledWith(req.user, 'contract-1');

    const famReq = mockRequest('FAMILY_REP');
    await controller.confirmCadenceSchedule(famReq, 'contract-1');
    expect(service.confirmCadenceSchedule).toHaveBeenCalledWith(famReq.user, 'contract-1');

    await controller.adjustCadenceMilestone(req, 'enc-1', { scheduledDate: '2026-07-01' });
    expect(service.adjustCadenceMilestone).toHaveBeenCalledWith(req.user, 'enc-1', {
      scheduledDate: '2026-07-01',
    });

    await controller.backfillCadence(req, 'contract-1');
    expect(service.generateContractPeriodicCadence).toHaveBeenCalledWith('contract-1', {
      triggeredBy: req.user.id,
      force: false,
    });
  });
});
