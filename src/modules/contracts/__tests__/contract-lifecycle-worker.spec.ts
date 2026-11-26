import { ContractLifecycleWorkerService } from '../services/contract-lifecycle-worker.service';

describe('ContractLifecycleWorkerService (R1, R2, R3)', () => {
  it('chuyển kỳ cũ hết hạn sang EXPIRED, kích hoạt PENDING_ACTIVATION khi tới startDate và giữ nguyên ACTIVE nếu endDate === today', async () => {
    const now = new Date('2026-12-11T00:30:00.000Z'); // 07:30 VN ngày 2026-12-11

    const tx: any = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      medicalContract: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'old-ctr-1',
          contractStatus: 'ACTIVE',
          doctorId: 'doc-1',
        }),
        update: jest.fn().mockResolvedValue({}),
        count: jest.fn().mockResolvedValue(1),
      },
      encounter: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      doctor: {
        update: jest.fn().mockResolvedValue({}),
      },
      notification: {
        createMany: jest.fn().mockResolvedValue({ count: 3 }),
      },
    };

    const prisma: any = {
      medicalContract: {
        findMany: jest
          .fn()
          // Lần 1: PENDING_ACTIVATION có startDate <= today
          .mockResolvedValueOnce([
            {
              id: 'ren-1',
              upgradedFromId: 'old-ctr-1',
              doctorId: 'doc-1',
              startDate: new Date('2026-12-11T00:00:00.000Z'),
              endDate: new Date('2027-03-11T00:00:00.000Z'),
              familyUnit: { representativeUserId: 'u-fam-1' },
              facility: { userId: 'u-fac-1' },
              doctor: { userId: 'u-doc-1' },
            },
          ])
          // Lần 2: ACTIVE có endDate < today (không bao gồm endDate === today)
          .mockResolvedValueOnce([
            {
              id: 'old-expired-2',
              doctorId: 'doc-2',
              endDate: new Date('2026-12-10T00:00:00.000Z'),
            },
          ]),
      },
      $transaction: jest.fn(async (cb: (client: typeof tx) => Promise<void>) => cb(tx)),
    };

    const autoScheduleFirstVisit: any = {
      scheduleOnContractActivated: jest.fn().mockResolvedValue(undefined),
    };

    const worker = new ContractLifecycleWorkerService(prisma, autoScheduleFirstVisit);
    const result = await worker.runDailyLifecycleTransitions(now);

    expect(result).toEqual({ activatedRenewals: 1, expiredContracts: 1 });
    // Kiểm tra query ACTIVE hết hạn dùng lt: today (endDate < today -> endDate === today được giữ nguyên)
    expect(prisma.medicalContract.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: {
          contractStatus: 'ACTIVE',
          endDate: { lt: new Date('2026-12-11T00:00:00.000Z') },
        },
      }),
    );
    // Kỳ cũ old-ctr-1 chuyển EXPIRED trước, kỳ mới ren-1 chuyển ACTIVE
    expect(tx.medicalContract.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'old-ctr-1' },
        data: { contractStatus: 'EXPIRED' },
      }),
    );
    expect(tx.medicalContract.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ren-1' },
        data: { contractStatus: 'ACTIVE' },
      }),
    );
    expect(autoScheduleFirstVisit.scheduleOnContractActivated).toHaveBeenCalledWith(tx, 'ren-1');
    expect(tx.medicalContract.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'old-expired-2' },
        data: { contractStatus: 'EXPIRED' },
      }),
    );
  });
});
