import {
  EncounterCategory,
  EncounterStatus,
  EncounterType,
  EncounterVisitScope,
} from '@prisma/client';
import { AutoScheduleFirstVisitService } from '../services/impl/auto-schedule-first-visit.service';
import { parseEncounterScheduleMeta } from '../utils/encounter-schedule-meta.util';

describe('AutoScheduleFirstVisitService (Package Default Cadence Drafts)', () => {
  let service: AutoScheduleFirstVisitService;
  let mockTx: any;

  const baseContract = {
    id: 'contract-1',
    contractNumber: 'MC-2026-001',
    doctorId: 'doctor-1',
    remainingHomeVisits: 4,
    remainingTelehealth: 2,
    startDate: new Date('2026-01-05T00:00:00.000Z'),
    endDate: new Date('2027-01-05T00:00:00.000Z'),
    servicePackage: {
      durationMonths: 12,
      periodicVisitsQuota: 4,
    },
    familyUnit: {
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
      medicalContract: {
        findUnique: jest.fn().mockResolvedValue(baseContract),
        update: jest.fn().mockResolvedValue({}),
      },
      encounter: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({ id: `enc-draft-${Math.random()}`, ...data }),
        ),
      },
      notification: {
        createMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
    };
  });

  it('generates all N periodic CADENCE_DRAFT milestones avoiding Sundays and busy slots without deducting quota', async () => {
    // Slot 08:30 busy on milestone 1 -> must pick 09:30
    mockTx.encounter.findMany.mockResolvedValueOnce([
      { scheduledTime: new Date('1970-01-01T08:30:00.000Z') },
    ]);

    const result = await service.scheduleOnContractActivated(
      mockTx,
      'contract-1',
    );

    expect(result).toHaveLength(4);
    expect(mockTx.encounter.create).toHaveBeenCalledTimes(4);
    // Never deducts quota at draft stage
    expect(mockTx.medicalContract.update).not.toHaveBeenCalled();

    const firstCreateArg = mockTx.encounter.create.mock.calls[0][0].data;
    expect(firstCreateArg).toEqual(
      expect.objectContaining({
        contractId: 'contract-1',
        doctorId: 'doctor-1',
        encounterType: EncounterType.HOME_VISIT,
        category: EncounterCategory.PERIODIC_ROUTINE,
        visitScope: EncounterVisitScope.FAMILY,
        encounterStatus: EncounterStatus.REQUESTED,
        scheduledTime: new Date('1970-01-01T09:30:00.000Z'),
        participants: {
          create: [{ patientId: 'pat-1' }, { patientId: 'pat-2' }],
        },
      }),
    );

    // Every generated milestone avoids Sunday and carries CADENCE_DRAFT metadata
    for (let i = 0; i < 4; i++) {
      const data = mockTx.encounter.create.mock.calls[i][0].data;
      expect(data.scheduledDate.getUTCDay()).not.toBe(0);
      expect(data.scheduledDate.getTime()).toBeLessThan(
        baseContract.endDate.getTime(),
      );
      const parsed = parseEncounterScheduleMeta(data);
      expect(parsed.scheduleStage).toBe('CADENCE_DRAFT');
      expect(parsed.milestoneIndex).toBe(i + 1);
      expect(parsed.totalMilestones).toBe(4);
    }

    expect(mockTx.notification.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          userId: 'user-doc-1',
          type: 'ENCOUNTER_CADENCE_DRAFT_READY',
        }),
        expect.objectContaining({
          userId: 'user-fam-1',
          type: 'ENCOUNTER_CADENCE_DRAFT_READY',
        }),
      ]),
    });
  });

  it('is idempotent and skips creation if contract already has a non-cancelled PERIODIC_ROUTINE encounter', async () => {
    mockTx.encounter.findFirst.mockResolvedValueOnce({ id: 'enc-existing' });

    const result = await service.scheduleOnContractActivated(
      mockTx,
      'contract-1',
    );

    expect(result).toEqual([]);
    expect(mockTx.encounter.create).not.toHaveBeenCalled();
  });

  it('generates FAMILY draft milestones even when contract has no pre-assigned members', async () => {
    mockTx.medicalContract.findUnique.mockResolvedValueOnce({
      ...baseContract,
      members: [],
    });

    const result = await service.scheduleOnContractActivated(
      mockTx,
      'contract-1',
    );

    expect(result).toHaveLength(4);
    const firstData = mockTx.encounter.create.mock.calls[0][0].data;
    expect(firstData.visitScope).toBe(EncounterVisitScope.FAMILY);
    expect(firstData.participants).toBeUndefined();
    expect(firstData.encounterStatus).toBe(EncounterStatus.REQUESTED);
  });
});
