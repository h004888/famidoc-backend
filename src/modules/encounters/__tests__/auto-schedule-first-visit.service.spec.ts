import {
  EncounterCategory,
  EncounterStatus,
  EncounterType,
  EncounterVisitScope,
} from '@prisma/client';
import { AutoScheduleFirstVisitService } from '../services/impl/auto-schedule-first-visit.service';
import { calculateCadenceDates } from '../services/impl/encounters.service.impl';
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

  it('EF1: notifies facility & family and skips when homeAddress is missing or placeholder or doctorId missing', async () => {
    mockTx.medicalContract.findUnique.mockResolvedValueOnce({
      ...baseContract,
      homeVisitAddress: null,
      familyUnit: { ...baseContract.familyUnit, homeAddress: 'Chưa cập nhật địa chỉ' },
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

  it('auto-schedules when contract.members is empty (post-payment member onboarding) and contract.homeVisitAddress is valid', async () => {
    mockTx.medicalContract.findUnique.mockResolvedValueOnce({
      ...baseContract,
      homeVisitAddress: 'Số 10 Nguyễn Trãi, Phường Thượng Đình, Thành phố Hà Nội',
      familyUnit: { ...baseContract.familyUnit, homeAddress: 'Chưa cập nhật địa chỉ' },
      members: [],
    });
    mockTx.patient = {
      findMany: jest.fn().mockResolvedValue([{ id: 'pat-head' }]),
    };

    const result = await service.scheduleOnContractActivated(mockTx, 'contract-1');
    expect(result).toHaveLength(4);
    expect(mockTx.notification.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          type: 'ENCOUNTER_AUTO_CONFIRMED',
        }),
      ]),
    });
    expect(mockTx.encounter.create.mock.calls[0][0].data.participants).toEqual({
      create: [{ patientId: 'pat-head' }],
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

  it('calculateCadenceDates rải đều 10 buổi trong gói 1 tháng (không dồn về endDate - 1) và không trùng ngày nghỉ/lễ', () => {
    const start = new Date('2026-05-01T00:00:00.000Z');
    const end = new Date('2026-06-01T00:00:00.000Z');
    const dates = calculateCadenceDates(start, 1, 10, end);

    expect(dates).toHaveLength(10);
    const isoList = dates.map((d) => d.toISOString().slice(0, 10));
    expect(new Set(isoList).size).toBe(10);
    expect(isoList.every((iso) => iso >= '2026-05-01' && iso < '2026-06-01')).toBe(true);
    expect(isoList).not.toContain('2026-05-01'); // Ngày lễ 05-01

    const spanDays = (dates[9].getTime() - dates[0].getTime()) / (24 * 60 * 60 * 1000);
    expect(spanDays).toBeGreaterThanOrEqual(20);
  });

  it('calculateCadenceDates rải đều 12 buổi cho gói 12 tháng, tất cả < endDate và không rơi vào Chủ nhật', () => {
    const start = new Date('2026-01-01T00:00:00.000Z');
    const end = new Date('2027-01-01T00:00:00.000Z');
    const dates = calculateCadenceDates(start, 12, 12, end);

    expect(dates).toHaveLength(12);
    const isoList = dates.map((d) => d.toISOString().slice(0, 10));
    expect(new Set(isoList).size).toBe(12);
    expect(dates.every((d) => d.getTime() < end.getTime())).toBe(true);
    expect(dates.every((d) => d.getUTCDay() !== 0)).toBe(true);
  });

  it('gói 1 tháng 15 buổi: dù 7 ngày cuối tháng bị kín, vẫn mở rộng quét toàn bộ [startDate, endDate) để CONFIRMED đủ 15 buổi khác ngày', async () => {
    mockTx.medicalContract.findUnique.mockResolvedValueOnce({
      ...baseContract,
      remainingHomeVisits: 15,
      startDate: new Date('2026-06-01T00:00:00.000Z'),
      endDate: new Date('2026-07-01T00:00:00.000Z'),
      servicePackage: {
        durationMonths: 1,
        periodicVisitsQuota: 15,
      },
    });
    mockTx.encounter.findMany.mockImplementation(async ({ where }: any) => {
      const iso = where?.scheduledDate?.toISOString().slice(0, 10) ?? '';
      if (iso >= '2026-06-23') {
        return [
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
        ];
      }
      return [];
    });

    const result = await service.scheduleOnContractActivated(mockTx, 'contract-1');
    expect(result).toHaveLength(15);
    const createdDates = mockTx.encounter.create.mock.calls.map((c: any) =>
      c[0].data.scheduledDate.toISOString().slice(0, 10),
    );
    expect(new Set(createdDates).size).toBe(15);
    expect(
      mockTx.encounter.create.mock.calls.every(
        (c: any) => c[0].data.encounterStatus === EncounterStatus.CONFIRMED,
      ),
    ).toBe(true);
  });
});
