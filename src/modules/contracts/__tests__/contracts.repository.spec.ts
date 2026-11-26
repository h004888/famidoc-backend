import { PrismaContractsSession } from '../repositories/impl/contracts.repository.impl';

describe('PrismaContractsSession Documenso & legacy signature helpers', () => {
  function makeMockTx() {
    return {
      contractDocumensoSigner: {
        upsert: jest.fn().mockResolvedValue({ id: 'signer-1' }),
        deleteMany: jest.fn().mockResolvedValue({ count: 4 }),
      },
      contractSignature: {
        deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      medicalContract: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({ id: 'ctr-1' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        count: jest.fn().mockResolvedValue(0),
      },
      systemConfiguration: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      encounter: {
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      facilitySettlement: {
        count: jest.fn().mockResolvedValue(0),
      },
      invoice: {
        count: jest.fn().mockResolvedValue(0),
      },
      doctor: {
        count: jest.fn().mockResolvedValue(0),
      },
      complaint: {
        count: jest.fn().mockResolvedValue(0),
      },
    };
  }

  it('saveDocumensoSigners(): bỏ qua mảng rỗng, upsert theo contractId_signerRole và không nuốt lỗi DB', async () => {
    const tx = makeMockTx();
    const session = new PrismaContractsSession(tx as any);

    await session.saveDocumensoSigners([]);
    expect(tx.contractDocumensoSigner.upsert).not.toHaveBeenCalled();

    const rows = [
      {
        contractId: 'ctr-1',
        signerRole: 'FAMILY_REP' as const,
        documensoRecipientId: 101,
        documensoToken: 'tok-1',
        documensoSigningUrl: 'https://sign.famidoc.online/sign/tok-1',
        status: 'PENDING',
        completedAt: null,
      },
    ];
    await session.saveDocumensoSigners(rows);

    expect(tx.contractDocumensoSigner.upsert).toHaveBeenCalledWith({
      where: {
        contractId_signerRole: {
          contractId: 'ctr-1',
          signerRole: 'FAMILY_REP',
        },
      },
      update: {
        documensoRecipientId: 101,
        documensoToken: 'tok-1',
        documensoSigningUrl: 'https://sign.famidoc.online/sign/tok-1',
        status: 'PENDING',
        completedAt: null,
      },
      create: rows[0],
    });

    tx.contractDocumensoSigner.upsert.mockRejectedValueOnce(new Error('DB constraint error'));
    await expect(session.saveDocumensoSigners(rows)).rejects.toThrow('DB constraint error');
  });

  it('clearDocumensoState(): xóa signer của hợp đồng và clear documensoEnvelopeId/documensoItemId', async () => {
    const tx = makeMockTx();
    const session = new PrismaContractsSession(tx as any);

    await session.clearDocumensoState('ctr-1');

    expect(tx.contractDocumensoSigner.deleteMany).toHaveBeenCalledWith({
      where: { contractId: 'ctr-1' },
    });
    expect(tx.medicalContract.update).toHaveBeenCalledWith({
      where: { id: 'ctr-1' },
      data: {
        documensoEnvelopeId: null,
        documensoItemId: null,
      },
    });
  });

  it('updateContractDocumensoEnvelope(): lọc theo PENDING_APPROVAL, isDemo=false, documensoEnvelopeId=null và trả về boolean theo count', async () => {
    const tx = makeMockTx();
    const session = new PrismaContractsSession(tx as any);

    const won = await session.updateContractDocumensoEnvelope(
      'ctr-1',
      'env-1',
      'item-1',
    );
    expect(won).toBe(true);
    expect(tx.medicalContract.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'ctr-1',
        documensoEnvelopeId: null,
        contractStatus: 'PENDING_APPROVAL',
        isDemo: false,
      },
      data: {
        documensoEnvelopeId: 'env-1',
        documensoItemId: 'item-1',
      },
    });

    tx.medicalContract.updateMany.mockResolvedValueOnce({ count: 0 });
    const lost = await session.updateContractDocumensoEnvelope(
      'ctr-1',
      'env-2',
      'item-2',
    );
    expect(lost).toBe(false);
  });

  it('clearLegacyNonDocumensoSignatures(): chỉ xóa chữ ký hợp đồng chính có documensoRecipientId IS NULL', async () => {
    const tx = makeMockTx();
    const session = new PrismaContractsSession(tx as any);

    await session.clearLegacyNonDocumensoSignatures('ctr-1');

    expect(tx.contractSignature.deleteMany).toHaveBeenCalledWith({
      where: {
        contractId: 'ctr-1',
        addendumId: null,
        documensoRecipientId: null,
      },
    });
  });

  it('getStaffingTerminationImpact(): dùng đúng trường encounterStatus trên model Encounter (bao gồm PENDING_RECORD & DISPUTED)', async () => {
    const tx = makeMockTx();
    tx.encounter.count.mockResolvedValueOnce(2);
    const session = new PrismaContractsSession(tx as any);

    const result = await session.getStaffingTerminationImpact('fac-1');

    expect(result.openEncounters).toBe(2);
    expect(tx.encounter.count).toHaveBeenCalledWith({
      where: {
        contract: { facilityId: 'fac-1' },
        encounterStatus: {
          in: ['REQUESTED', 'CONFIRMED', 'IN_PROGRESS', 'PENDING_RECORD', 'DISPUTED'],
        },
      },
    });
  });

  it('hasEncounterInProgress(): kiểm tra IN_PROGRESS, PENDING_RECORD và DISPUTED', async () => {
    const tx = makeMockTx();
    tx.encounter.findFirst.mockResolvedValueOnce({ id: 'enc-1' });
    const session = new PrismaContractsSession(tx as any);

    const hasInProgress = await session.hasEncounterInProgress('ctr-1');

    expect(hasInProgress).toBe(true);
    expect(tx.encounter.findFirst).toHaveBeenCalledWith({
      where: {
        contractId: 'ctr-1',
        encounterStatus: { in: ['IN_PROGRESS', 'PENDING_RECORD', 'DISPUTED'] },
      },
      select: { id: true },
    });
  });

  it('findOpenUpgrade(): bao gồm cả PENDING_ACTIVATION ngoài PENDING_APPROVAL, PENDING_PAYMENT, ACTIVE', async () => {
    const tx = makeMockTx();
    const session = new PrismaContractsSession(tx as any);

    await session.findOpenUpgrade('src-1');

    expect(tx.medicalContract.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          upgradedFromId: 'src-1',
          contractStatus: {
            in: ['PENDING_APPROVAL', 'PENDING_PAYMENT', 'PENDING_ACTIVATION', 'ACTIVE'],
          },
        },
      }),
    );
  });

  it('getRenewalGraceDays(): mặc định 7 ngày, nhận giá trị >= 7 và ép tối thiểu 7 ngày', async () => {
    const tx = makeMockTx();
    const session = new PrismaContractsSession(tx as any);

    tx.systemConfiguration.findUnique.mockResolvedValueOnce(null);
    await expect((session as any).getRenewalGraceDays()).resolves.toBe(7);

    tx.systemConfiguration.findUnique.mockResolvedValueOnce({ configValue: '14' });
    await expect((session as any).getRenewalGraceDays()).resolves.toBe(14);

    tx.systemConfiguration.findUnique.mockResolvedValueOnce({ configValue: '3' });
    await expect((session as any).getRenewalGraceDays()).resolves.toBe(7);
  });

  it('updateContractStatus(): hỗ trợ CANCELLED, clear holdExpiresAt và hủy lịch hẹn tương lai', async () => {
    const tx = makeMockTx();
    const session = new PrismaContractsSession(tx as any);

    await session.updateContractStatus('ctr-cancel' as any, 'CANCELLED' as any, 'Hủy yêu cầu gia hạn');

    expect(tx.medicalContract.update).toHaveBeenCalledWith({
      where: { id: 'ctr-cancel' },
      data: expect.objectContaining({
        contractStatus: 'CANCELLED',
        terminationReason: 'Hủy yêu cầu gia hạn',
        terminatedAt: expect.any(Date),
        holdExpiresAt: null,
      }),
    });
    expect(tx.encounter.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          contractId: 'ctr-cancel',
          encounterStatus: { in: ['REQUESTED', 'CONFIRMED'] },
        }),
        data: {
          encounterStatus: 'CANCELLED',
          cancelReason: 'Hủy yêu cầu gia hạn',
        },
      }),
    );
  });

  it('getStaffingTerminationImpact(): đếm cả PENDING_ACTIVATION và PAID_PENDING_APPROVAL vào pendingMedicalContracts', async () => {
    const tx = makeMockTx();
    const session = new PrismaContractsSession(tx as any);

    await session.getStaffingTerminationImpact('fac-1');

    expect(tx.medicalContract.count).toHaveBeenCalledWith({
      where: {
        facilityId: 'fac-1',
        contractStatus: {
          in: [
            'PENDING_APPROVAL',
            'PENDING_PAYMENT',
            'PAID_PENDING_APPROVAL',
            'PENDING_ACTIVATION',
          ],
        },
      },
    });
  });
});
