import { EncounterStatus, EncounterType } from '@prisma/client';
import { VideoSlaScheduler } from '../services/impl/video-sla.scheduler';

describe('VideoSlaScheduler', () => {
  it('tự động hủy REQUESTED quá hạn SLA và nhả heldTelehealth (idempotent)', async () => {
    const prisma: any = {
      encounter: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([
            {
              id: 'enc-exp',
              contractId: 'ctr-1',
              contract: { servicePackage: { videoQuotaPolicy: 'FIXED' } },
            },
          ])
          .mockResolvedValueOnce([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      medicalContract: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    const scheduler = new VideoSlaScheduler(prisma);
    const res = await scheduler.runVideoLifecycleSweep(new Date('2026-11-24T10:00:00.000Z'));

    expect(res.expiredRequests).toBe(1);
    expect(prisma.medicalContract.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ctr-1', heldTelehealth: { gt: 0 } },
        data: { heldTelehealth: { decrement: 1 } },
      }),
    );
  });

  it('chuyển NO_SHOW sau T+15p và hoàn 100% lượt nếu Bác sĩ vắng mặt', async () => {
    const prisma: any = {
      encounter: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([
            {
              id: 'enc-ns',
              contractId: 'ctr-1',
              scheduledDate: new Date('2026-11-24T00:00:00.000Z'),
              scheduledTime: new Date('1970-01-01T09:00:00.000Z'),
              telehealthSession: { doctorJoinedAt: null, familyJoinedAt: new Date() },
              contract: { servicePackage: { videoQuotaPolicy: 'FIXED' } },
            },
          ]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      medicalContract: {
        update: jest.fn().mockResolvedValue({}),
      },
    };

    const scheduler = new VideoSlaScheduler(prisma);
    // 09:20 UTC+7 = 02:20 UTC
    const res = await scheduler.runVideoLifecycleSweep(new Date('2026-11-24T02:20:00.000Z'));

    expect(res.noShows).toBe(1);
    expect(prisma.encounter.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { encounterStatus: EncounterStatus.NO_SHOW },
      }),
    );
    expect(prisma.medicalContract.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ctr-1' },
        data: { remainingTelehealth: { increment: 1 } },
      }),
    );
  });
});
