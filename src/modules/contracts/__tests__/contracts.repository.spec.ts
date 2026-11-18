import { PrismaContractsSession } from '../repositories/impl/contracts.repository.impl';

describe('PrismaContractsSession Documenso & legacy signature helpers', () => {
  function makeMockTx() {
    return {
      contractDocumensoSigner: {
        createMany: jest.fn().mockResolvedValue({ count: 4 }),
      },
      contractSignature: {
        deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      medicalContract: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        count: jest.fn().mockResolvedValue(0),
      },
      encounter: {
        count: jest.fn().mockResolvedValue(0),
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

  it('saveDocumensoSigners(): bỏ qua mảng rỗng và gọi createMany với skipDuplicates: true', async () => {
    const tx = makeMockTx();
    const session = new PrismaContractsSession(tx as any);

    await session.saveDocumensoSigners([]);
    expect(tx.contractDocumensoSigner.createMany).not.toHaveBeenCalled();

    const rows = [
      {
        contractId: 'ctr-1',
        signerRole: 'FAMILY_REP',
        documensoRecipientId: 101,
        documensoToken: 'tok-1',
        documensoSigningUrl: 'https://sign.famidoc.online/sign/tok-1',
        status: 'PENDING',
        completedAt: null,
      },
    ];
    await session.saveDocumensoSigners(rows);

    expect(tx.contractDocumensoSigner.createMany).toHaveBeenCalledWith({
      data: rows,
      skipDuplicates: true,
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

  it('getStaffingTerminationImpact(): dùng đúng trường encounterStatus trên model Encounter', async () => {
    const tx = makeMockTx();
    tx.encounter.count.mockResolvedValueOnce(2);
    const session = new PrismaContractsSession(tx as any);

    const result = await session.getStaffingTerminationImpact('fac-1');

    expect(result.openEncounters).toBe(2);
    expect(tx.encounter.count).toHaveBeenCalledWith({
      where: {
        contract: { facilityId: 'fac-1' },
        encounterStatus: { in: ['REQUESTED', 'CONFIRMED', 'IN_PROGRESS'] },
      },
    });
  });
});
