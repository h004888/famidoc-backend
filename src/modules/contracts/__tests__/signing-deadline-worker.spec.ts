import { SigningDeadlineWorker } from '../services/signing-deadline-worker.service';
import { queueSigningNotices, SIGNING_EXPIRED_REASON } from '../services/signing-deadline';

describe('SigningDeadlineWorker', () => {
  const deadline = new Date('2026-11-25T00:00:00Z');
  const now = new Date(deadline.getTime() + 1);
  const item = { id: 'contract', documensoEnvelopeId: 'envelope' };

  it('sends the reminder only to a role that still needs to sign', async () => {
    const previousUrl = process.env.APP_PUBLIC_URL;
    process.env.APP_PUBLIC_URL = 'https://famidoc.online';
    const sent = jest.fn();
    const currentTime = new Date();
    const jobs = ['ASSIGNED_DOCTOR', 'HEALTHCARE_FACILITY'].map(role => ({
      contractId: item.id, role, kind: 'REMINDER', nextAttemptAt: currentTime,
    }));
    const prisma = {
      contractSigningNotice: {
        findMany: jest.fn().mockResolvedValue(jobs),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      medicalContract: {
        findFirst: jest.fn().mockResolvedValue({ id: item.id }),
        findUnique: jest.fn().mockResolvedValue({
          id: item.id, contractNumber: 'FD-001', contractStatus: 'PENDING_APPROVAL',
          signingDeadlineAt: new Date(currentTime.getTime() + 30 * 60_000),
          signatures: [{ signerRole: 'FAMILY_REP' }, { signerRole: 'HEALTHCARE_FACILITY' }],
          documensoSigners: [],
          doctor: { user: { email: 'doctor@example.com' } },
          servicePackage: { packageName: 'Gói gia đình' },
        }),
      },
    };
    try {
      const worker = new SigningDeadlineWorker(prisma as never, {} as never, {} as never, { sendMail: sent });
      await worker.sendNotices(currentTime);
      expect(sent).toHaveBeenCalledTimes(1);
      expect(sent).toHaveBeenCalledWith(expect.objectContaining({
        to: 'doctor@example.com',
        text: expect.stringContaining('https://bacsi.famidoc.online/doctor/contracts/contract'),
      }));
    } finally {
      if (previousUrl === undefined) delete process.env.APP_PUBLIC_URL;
      else process.env.APP_PUBLIC_URL = previousUrl;
    }
  });
  function setup() {
    const tx = {
      $queryRaw: jest.fn(),
      medicalContract: {
        findUnique: jest.fn().mockResolvedValue({
          ...item,
          signingDeadlineAt: deadline,
          contractStatus: 'PENDING_APPROVAL',
          signatures: [{ signerRole: 'FAMILY_REP' }],
          invoices: [],
        }),
        update: jest.fn(),
      },
      invoice: { updateMany: jest.fn() },
      matchingSession: { updateMany: jest.fn() },
      matchingQueueRequest: { updateMany: jest.fn() },
      contractDocumensoSigner: { deleteMany: jest.fn() },
      contractSigningNotice: { updateMany: jest.fn() },
    };
    const prisma = {
      $transaction: jest.fn((fn) => fn(tx)),
      medicalContract: {
        findMany: jest.fn().mockResolvedValue([item]),
        updateMany: jest.fn(),
      },
    };
    const sync = {
      syncContractFromDocumenso: jest.fn().mockResolvedValue({ synced: true }),
    };
    const client = { revokeSigningEnvelope: jest.fn() };
    const worker = new SigningDeadlineWorker(
      prisma as never,
      client as never,
      sync as never,
    );
    return { worker, prisma, tx, client, sync };
  }

  it('keeps the reservation if Documenso could not verify the signature timestamp', async () => {
    const { worker, sync, prisma, tx } = setup();
    sync.syncContractFromDocumenso.mockResolvedValue({
      synced: true,
      signingEvidenceIncomplete: true,
    });
    await worker.expireContracts(now);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.medicalContract.update).not.toHaveBeenCalled();
  });

  it('rechecks under the lock and preserves a contract that moved to payment', async () => {
    const { worker, tx } = setup();
    tx.medicalContract.findUnique.mockResolvedValue({
      contractStatus: 'PENDING_PAYMENT',
      signingDeadlineAt: deadline,
    });
    await worker.expireContracts(now);
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.medicalContract.update).not.toHaveBeenCalled();
  });

  it('never terminates a registration with a paid invoice', async () => {
    const { worker, tx } = setup();
    tx.medicalContract.findUnique.mockResolvedValue({
      ...item,
      contractStatus: 'PENDING_APPROVAL',
      signingDeadlineAt: deadline,
      invoices: [{ id: 'paid' }],
      signatures: [],
    });
    await worker.expireContracts(now);
    expect(tx.medicalContract.update).not.toHaveBeenCalled();
  });

  it('terminates only the expired registration and retains the envelope for retries', async () => {
    const { worker, tx, prisma, client } = setup();
    await worker.expireContracts(now);
    expect(tx.medicalContract.update).toHaveBeenCalledWith({
      where: { id: item.id },
      data: expect.objectContaining({
        contractStatus: 'TERMINATED',
        terminationReason: SIGNING_EXPIRED_REASON,
        holdExpiresAt: null,
      }),
    });
    expect(tx.matchingSession.updateMany).toHaveBeenCalledWith({
      where: { contractId: item.id, status: 'CONFIRMED' },
      data: { status: 'EXPIRED' },
    });
    expect(tx.invoice.updateMany).toHaveBeenCalledWith({
      where: { contractId: item.id, paymentStatus: 'PENDING' },
      data: { paymentStatus: 'CANCELLED' },
    });

    client.revokeSigningEnvelope.mockRejectedValueOnce(new Error('timeout'));
    await worker.revokeEnvelopes();
    expect(prisma.medicalContract.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { documensoEnvelopeId: null } }),
    );
    await worker.revokeEnvelopes();
    expect(prisma.medicalContract.updateMany).toHaveBeenCalledWith({
      where: { id: item.id, documensoEnvelopeId: 'envelope' },
      data: { documensoEnvelopeId: null },
    });
  });

  it('alerts operations when Documenso verification exceeds retry threshold', async () => {
    const { worker, sync, prisma } = setup();
    sync.syncContractFromDocumenso.mockRejectedValue(new Error('documenso down'));
    const errorSpy = jest.spyOn((worker as any).logger, 'error').mockImplementation();

    for (let i = 0; i < 5; i += 1) {
      await worker.expireContracts(now);
    }

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[CẢNH BÁO VẬN HÀNH]'));
  });

  it('queues a single URGENT notice per remaining role when FAMILY_REP signs in the last hour', async () => {
    const createMany = jest.fn().mockResolvedValue({ count: 3 });
    const tx = { contractSigningNotice: { createMany } } as never;
    const contractDeadline = new Date('2026-11-25T10:00:00Z');
    const signedAt = new Date('2026-11-25T09:20:00Z');

    await queueSigningNotices(tx, 'contract-urgent', contractDeadline, signedAt);

    expect(createMany).toHaveBeenCalledTimes(1);
    const arg = createMany.mock.calls[0][0];
    expect(arg.data).toHaveLength(3);
    expect(arg.data.every((row: any) => row.kind === 'URGENT')).toBe(true);
    expect(arg.data.map((row: any) => row.role)).toEqual([
      'HEALTHCARE_FACILITY',
      'ASSIGNED_DOCTOR',
      'ADMIN',
    ]);
  });
});
