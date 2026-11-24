import {
  EncounterCategory,
  EncounterStatus,
  EncounterType,
  EncounterVisitScope,
} from '@prisma/client';
import { AutoScheduleFirstVisitService } from '../services/impl/auto-schedule-first-visit.service';
import { parseEncounterScheduleMeta } from '../utils/encounter-schedule-meta.util';

describe('AutoScheduleFirstVisitService (Two-Slot Auto-Confirm & Exceptions)', () => {
  let service: AutoScheduleFirstVisitService;
  let mockTx: any;

  const baseContract = {
    id: 'contract-1',
    contractNumber: 'MC-2026-001',
    doctorId: 'doctor-1',
    familyId: 'family-1',
    remainingHomeVisits: 4,
    remainingTelehealth: 2,
    startDate: new Date('2026-01-05T00:00:00.000Z'),
    endDate: new Date('2027-01-05T00:00:00.000Z'),
    servicePackage: {
      durationMonths: 12,
      periodicVisitsQuota: 4,
    },
    familyUnit: {
      homeAddress: '12 Kim Mã, Ba Đình, Hà Nội',
      representativeUserId: 'user-fam-1',
      representativeUser: { fullName: 'Nguyễn Văn An' },
    },
    doctor: {
      doctorName: 'BS. Trần Thanh Mai',
      user: { id: 'user-doc-1' },
    },
    facility: { userId: 'user-fac-1' },
    members: [{ patientId: 'pat-1' }, { patientId: 'pat-2' }],
  };

  beforeEach(() => {
    service = new AutoScheduleFirstVisitService();
    mockTx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      medicalContract: {
        findUnique: jest.fn().mockResolvedValue(baseContract),
      },
      encounter: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({ id: `enc-${Math.random()}`, ...data }),
        ),
      },
      notification: {
        createMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
    };
  });

  it('auto-confirms HOME_VISIT milestones using 2 slots (MORNING/AFTERNOON) and avoids occupied slot', async () => {
    // Morning slot occupied on milestone 1 -> must pick AFTERNOON (13:30)
    mockTx.encounter.findMany.mockResolvedValueOnce([
      {
        encounterType: EncounterType.HOME_VISIT,
        scheduledTime: new Date('1970-01-01T08:00:00.000Z'),
        contract: { familyId: 'other-family' },
      },
    ]);

    const result = await service.scheduleOnContractActivated(mockTx, 'contract-1');

    expect(result).toHaveLength(4);
    expect(mockTx.$executeRaw).toHaveBeenCalledTimes(1);

    const firstCreate = mockTx.encounter.create.mock.calls[0][0].data;
    expect(firstCreate).toEqual(
      expect.objectContaining({
        contractId: 'contract-1',
        doctorId: 'doctor-1',
        encounterType: EncounterType.HOME_VISIT,
        category: EncounterCategory.PERIODIC_ROUTINE,
        visitScope: EncounterVisitScope.FAMILY,
        encounterStatus: EncounterStatus.CONFIRMED,
        scheduledTime: new Date('1970-01-01T13:30:00.000Z'),
      }),
    );

    const parsed = parseEncounterScheduleMeta(firstCreate);
    expect(parsed.scheduleStage).toBe('CONFIRMED');
    expect(parsed.milestoneIndex).toBe(1);
    expect(parsed.totalMilestones).toBe(4);
  });

  it('AF1: skips auto-scheduling when contract has 0 remainingHomeVisits (Online-only package)', async () => {
    mockTx.medicalContract.findUnique.mockResolvedValueOnce({
      ...baseContract,
      remainingHomeVisits: 0,
      remainingTelehealth: 10,
    });

    const result = await service.scheduleOnContractActivated(mockTx, 'contract-1');
    expect(result).toEqual([]);
    expect(mockTx.encounter.create).not.toHaveBeenCalled();
  });

  it('EF1: notifies facility & family and skips when homeAddress or doctorId or members missing', async () => {
    mockTx.medicalContract.findUnique.mockResolvedValueOnce({
      ...baseContract,
      familyUnit: { ...baseContract.familyUnit, homeAddress: '' },
    });

    const result = await service.scheduleOnContractActivated(mockTx, 'contract-1');
    expect(result).toEqual([]);
    expect(mockTx.encounter.create).not.toHaveBeenCalled();
    expect(mockTx.notification.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          userId: 'user-fac-1',
          type: 'ENCOUNTER_AUTO_SCHEDULE_MISSING_DATA',
        }),
      ]),
    });
  });

  it('EF2: is idempotent when non-cancelled PERIODIC_ROUTINE already exists', async () => {
    mockTx.encounter.findFirst.mockResolvedValueOnce({ id: 'enc-existing' });

    const result = await service.scheduleOnContractActivated(mockTx, 'contract-1');
    expect(result).toEqual([]);
    expect(mockTx.encounter.create).not.toHaveBeenCalled();
  });

  it('EF3: creates MANUAL_SLOT_REQUIRED when all ±7 days are full instead of double-booking', async () => {
    // Every day queried has both MORNING & AFTERNOON occupied by HOME_VISIT
    mockTx.encounter.findMany.mockResolvedValue([
      {
        encounterType: EncounterType.HOME_VISIT,
        scheduledTime: new Date('1970-01-01T08:00:00.000Z'),
        contract: { familyId: 'other-1' },
      },
      {
        encounterType: EncounterType.HOME_VISIT,
        scheduledTime: new Date('1970-01-01T13:30:00.000Z'),
        contract: { familyId: 'other-2' },
      },
    ]);

    const result = await service.scheduleOnContractActivated(mockTx, 'contract-1');
    expect(result).toHaveLength(4);

    const firstData = mockTx.encounter.create.mock.calls[0][0].data;
    expect(firstData.encounterStatus).toBe(EncounterStatus.REQUESTED);
    const parsed = parseEncounterScheduleMeta(firstData);
    expect(parsed.scheduleStage).toBe('MANUAL_SLOT_REQUIRED');
  });
});
