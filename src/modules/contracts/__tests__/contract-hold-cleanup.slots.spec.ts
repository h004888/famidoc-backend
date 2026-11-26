import { ContractHoldCleanupService } from '../services/contract-hold-cleanup.service';
import type { SlotLedgerService } from '../../scheduling/slot-ledger.service';

describe('ContractHoldCleanupService (SlotLedger release)', () => {
  it('gọi releaseContractHolds cho đúng 2 hợp đồng quá TTL và không gọi cho hợp đồng chưa quá TTL', async () => {
    const now = new Date('2026-12-02T10:00:00.000Z');
    const expiredDrafts = [
      { id: 'contract-expired-1', documensoEnvelopeId: null },
      { id: 'contract-expired-2', documensoEnvelopeId: null },
    ];

    const tx = {
      medicalContract: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      contractDocumensoSigner: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      invoice: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };

    const prisma = {
      medicalContract: {
        findMany: jest.fn().mockResolvedValue(expiredDrafts),
      },
      $transaction: jest.fn(async (cb: (client: typeof tx) => Promise<boolean>) =>
        cb(tx),
      ),
    };

    const slotLedger: jest.Mocked<Pick<SlotLedgerService, 'releaseContractHolds'>> = {
      releaseContractHolds: jest.fn().mockResolvedValue(undefined),
    };

    const service = new ContractHoldCleanupService(
      prisma as any,
      undefined,
      slotLedger as unknown as SlotLedgerService,
    );

    const res = await service.releaseExpiredHolds(now);

    expect(res).toEqual({ released: 2 });
    expect(slotLedger.releaseContractHolds).toHaveBeenCalledTimes(2);
    expect(slotLedger.releaseContractHolds).toHaveBeenNthCalledWith(
      1,
      tx,
      'contract-expired-1',
    );
    expect(slotLedger.releaseContractHolds).toHaveBeenNthCalledWith(
      2,
      tx,
      'contract-expired-2',
    );

    // Hợp đồng chưa quá TTL → findMany trả về [] → không gọi releaseContractHolds thêm
    slotLedger.releaseContractHolds.mockClear();
    prisma.medicalContract.findMany.mockResolvedValueOnce([]);
    const resEmpty = await service.releaseExpiredHolds(now);
    expect(resEmpty).toEqual({ released: 0 });
    expect(slotLedger.releaseContractHolds).not.toHaveBeenCalled();
  });
});
