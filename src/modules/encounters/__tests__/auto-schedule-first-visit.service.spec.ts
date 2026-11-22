import {
  EncounterCategory,
  EncounterStatus,
  EncounterType,
  EncounterVisitScope,
} from '@prisma/client';
import { AutoScheduleFirstVisitService } from '../services/impl/auto-schedule-first-visit.service';

describe('AutoScheduleFirstVisitService', () => {
  let service: AutoScheduleFirstVisitService;
  let mockTx: any;

  const baseContract = {
    id: 'contract-1',
    doctorId: 'doctor-1',
    remainingHomeVisits: 4,
    remainingTelehealth: 2,
    endDate: new Date('2026-12-31T00:00:00.000Z'),
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
          Promise.resolve({ id: 'enc-auto-1', ...data }),
        ),
      },
      notification: {
        createMany: jest.fn().mockResolvedValue({ count: 3 }),
      },
    };
  });

  it('tạo buổi khám FAMILY CONFIRMED vào slot rảnh đầu tiên tránh Encounter khác, trừ quota và gửi thông báo 3 bên', async () => {
    // Đã có lịch khám chiếm 08:30 ngày đầu tiên -> phải nhảy sang 09:30
    mockTx.encounter.findMany.mockResolvedValueOnce([
      {
        scheduledTime: new Date('1970-01-01T08:30:00.000Z'),
      },
    ]);

    const now = new Date('2026-11-20T03:00:00.000Z'); // Thứ 6, ngày kế tiếp là Thứ 7 (2026-11-21)
    const result = await service.scheduleOnContractActivated(
      mockTx,
      'contract-1',
      now,
    );

    expect(result).toBeDefined();
    expect(mockTx.encounter.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        contractId: 'contract-1',
        doctorId: 'doctor-1',
        encounterType: EncounterType.HOME_VISIT,
        category: EncounterCategory.PERIODIC_ROUTINE,
        visitScope: EncounterVisitScope.FAMILY,
        encounterStatus: EncounterStatus.CONFIRMED,
        scheduledDate: new Date('2026-11-21T00:00:00.000Z'),
        scheduledTime: new Date('1970-01-01T09:30:00.000Z'),
        participants: {
          create: [{ patientId: 'pat-1' }, { patientId: 'pat-2' }],
        },
      }),
    });
    expect(mockTx.medicalContract.update).toHaveBeenCalledWith({
      where: { id: 'contract-1' },
      data: { remainingHomeVisits: { decrement: 1 } },
    });
    expect(mockTx.notification.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          userId: 'user-fam-1',
          type: 'ENCOUNTER_AUTO_CONFIRMED',
        }),
        expect.objectContaining({
          userId: 'user-doc-1',
          type: 'ENCOUNTER_AUTO_CONFIRMED',
        }),
        expect.objectContaining({
          userId: 'user-fac-1',
          type: 'ENCOUNTER_AUTO_CONFIRMED',
        }),
      ]),
    });
  });

  it('idempotent: không tạo trùng nếu hợp đồng đã có buổi khám PERIODIC_ROUTINE', async () => {
    mockTx.encounter.findFirst.mockResolvedValueOnce({ id: 'enc-existing' });

    const result = await service.scheduleOnContractActivated(
      mockTx,
      'contract-1',
    );

    expect(result).toBeNull();
    expect(mockTx.encounter.create).not.toHaveBeenCalled();
  });

  it('vẫn tạo được lịch FAMILY khi hợp đồng chưa có ContractMember nào', async () => {
    mockTx.medicalContract.findUnique.mockResolvedValueOnce({
      ...baseContract,
      members: [],
    });

    const result = await service.scheduleOnContractActivated(
      mockTx,
      'contract-1',
      new Date('2026-11-20T03:00:00.000Z'),
    );

    expect(result).toBeDefined();
    expect(mockTx.encounter.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        visitScope: EncounterVisitScope.FAMILY,
        encounterStatus: EncounterStatus.CONFIRMED,
      }),
    });
  });

  it('fallback an toàn khi kín lịch 30 ngày: không throw và gửi thông báo tự sắp lịch', async () => {
    mockTx.encounter.findMany.mockResolvedValue([
      { scheduledTime: new Date('1970-01-01T08:30:00.000Z') },
      { scheduledTime: new Date('1970-01-01T09:30:00.000Z') },
      { scheduledTime: new Date('1970-01-01T10:30:00.000Z') },
      { scheduledTime: new Date('1970-01-01T14:00:00.000Z') },
      { scheduledTime: new Date('1970-01-01T15:00:00.000Z') },
      { scheduledTime: new Date('1970-01-01T16:00:00.000Z') },
    ]);

    const result = await service.scheduleOnContractActivated(
      mockTx,
      'contract-1',
      new Date('2026-11-20T03:00:00.000Z'),
    );

    expect(result).toBeNull();
    expect(mockTx.encounter.create).not.toHaveBeenCalled();
    expect(mockTx.notification.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          userId: 'user-fam-1',
          type: 'ENCOUNTER_MANUAL_SCHEDULE_REQUIRED',
        }),
        expect.objectContaining({
          userId: 'user-doc-1',
          type: 'ENCOUNTER_MANUAL_SCHEDULE_REQUIRED',
        }),
      ]),
    });
  });
});
