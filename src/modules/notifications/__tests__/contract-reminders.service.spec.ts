import { ContractRemindersService } from '../services/contract-reminders.service';

describe('ContractRemindersService (R1 — nhắc hạn trước 7 ngày)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-26T05:00:00.000Z')); // today = 2026-11-26
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('chỉ lấy hợp đồng ACTIVE sắp hết hạn trong 7 ngày và chưa có kỳ gia hạn PENDING_ACTIVATION/ACTIVE, tạo thông báo CONTRACT_EXPIRY_7D', async () => {
    const prisma: any = {
      medicalContract: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'ctr-1',
            endDate: new Date('2026-12-01T00:00:00.000Z'),
            familyUnit: { representativeUserId: 'user-fam-1' },
          },
        ]),
      },
      notification: {
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    const service = new ContractRemindersService(prisma);
    const res = await service.runExpiryReminders();

    expect(res).toEqual({ created: 1 });
    expect(prisma.medicalContract.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          contractStatus: 'ACTIVE',
          isDemo: false,
          endDate: {
            gt: new Date('2026-11-26T00:00:00.000Z'),
            lte: new Date('2026-12-03T00:00:00.000Z'),
          },
          upgrades: {
            none: {
              contractStatus: { in: ['PENDING_ACTIVATION', 'ACTIVE'] },
            },
          },
        },
      }),
    );
    expect(prisma.notification.createMany).toHaveBeenCalledWith({
      data: [
        {
          userId: 'user-fam-1',
          title: 'Hợp đồng sắp hết hạn – Gia hạn ngay',
          content:
            'Hợp đồng hết hạn ngày 2026-12-01. Vui lòng gia hạn để duy trì dịch vụ không gián đoạn.',
          type: 'CONTRACT_EXPIRY_7D',
          referenceId: 'ctr-1',
        },
      ],
      skipDuplicates: true,
    });
  });
});
