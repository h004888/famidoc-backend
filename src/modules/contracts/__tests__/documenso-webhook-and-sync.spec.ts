import { UnauthorizedException } from '@nestjs/common';
import { DocumensoClientService } from '../services/documenso-client.service';
import { DocumensoSyncService } from '../services/documenso-sync.service';

describe('DocumensoWebhookAndSync', () => {
  let service: DocumensoSyncService;
  let client: DocumensoClientService;
  let paymentNoticeMock: { sendPaymentNotice: jest.Mock };
  let existingSignatures: Array<{ signerRole: string }>;
  let contractStatus: string;
  let contractUpdateMock: jest.Mock;
  let signatureCreateMock: jest.Mock;
  let signerUpdateMock: jest.Mock;
  let mockPrisma: any;
  let signingDeadlineAt: Date | null;
  let queueNotices: jest.Mock;

  beforeEach(() => {
    process.env.DOCUMENSO_WEBHOOK_SECRET = 'whsec_test_secret';
    existingSignatures = [];
    signingDeadlineAt = null;
    queueNotices = jest.fn().mockResolvedValue({ count: 6 });
    contractStatus = 'PENDING_APPROVAL';
    contractUpdateMock = jest.fn(async ({ data }: any) => {
      if (data.contractStatus) contractStatus = data.contractStatus;
      return { id: 'contract-1' };
    });
    signatureCreateMock = jest.fn(async ({ data }: any) => {
      existingSignatures.push({ signerRole: data.signerRole });
      return { id: `sig-${data.signerRole}` };
    });
    signerUpdateMock = jest.fn(async () => ({ id: 'signer-row' }));

    mockPrisma = {
      medicalContract: {
        findFirst: jest.fn(async ({ where }: any) =>
          where?.documensoEnvelopeId === 'envelope_1'
            ? { id: 'contract-1' }
            : null,
        ),
        findUnique: jest.fn(async () => ({
          id: 'contract-1',
          contractStatus,
          documensoEnvelopeId: 'envelope_1',
          documensoItemId: 'item_1',
          signatures: existingSignatures,
        })),
      },
      $transaction: jest.fn(async (fn: any) => {
        const txMock = {
          $queryRaw: jest.fn(async () => []),
          medicalContract: {
            findUnique: jest.fn(async () => ({
              id: 'contract-1',
              contractNumber: 'FD-001',
              signingDeadlineAt,
              contractStatus,
              documensoEnvelopeId: 'envelope_1',
              documensoItemId: 'item_1',
              totalAmount: 9600000,
              memberCount: 3,
              packageId: 'pkg-1',
              facilityId: 'fac-1',
              doctorId: 'doc-1',
              familyId: 'fam-1',
              startDate: new Date('2026-01-01'),
              endDate: new Date('2027-01-01'),
              familyUnit: { representativeUserId: 'user-family' },
              facility: { userId: 'user-facility' },
              doctor: { userId: 'user-doctor' },
              signatures: [...existingSignatures],
              documensoSigners: [
                { id: 's1', documensoRecipientId: 101, signerRole: 'FAMILY_REP', status: 'PENDING' },
                { id: 's2', documensoRecipientId: 102, signerRole: 'HEALTHCARE_FACILITY', status: 'PENDING' },
                { id: 's3', documensoRecipientId: 103, signerRole: 'ASSIGNED_DOCTOR', status: 'PENDING' },
                { id: 's4', documensoRecipientId: 104, signerRole: 'ADMIN', status: 'PENDING' },
              ],
            })),
            update: contractUpdateMock,
          },
          contractSignature: { create: signatureCreateMock },
          contractSigningNotice: { createMany: queueNotices },
          contractDocumensoSigner: { update: signerUpdateMock },
          user: { findFirst: jest.fn(async () => ({ id: 'user-admin' })) },
        };
        return fn(txMock);
      }),
    };

    client = new DocumensoClientService();
    paymentNoticeMock = { sendPaymentNotice: jest.fn().mockResolvedValue(undefined) };
    service = new DocumensoSyncService(
      mockPrisma,
      client,
      paymentNoticeMock as any,
    );
  });

  it('uses the signing timestamp, rejects signatures at the deadline and waits for missing evidence', async () => {
    signingDeadlineAt = new Date(Date.now() - 60_000);
    const result = await service.applySignedRecipients('contract-1', [
      { recipientId: 101, signingStatus: 'SIGNED', completedAt: new Date(signingDeadlineAt.getTime() - 1).toISOString() },
      { recipientId: 102, signingStatus: 'SIGNED', completedAt: signingDeadlineAt.toISOString() },
      { recipientId: 103, signingStatus: 'SIGNED' },
      { recipientId: 104, signingStatus: 'NOT_SIGNED' },
    ], 'test', true);
    expect(result.signedRoles).toEqual(['FAMILY_REP']);
    expect(result.signingEvidenceIncomplete).toBe(true);
    expect(queueNotices).not.toHaveBeenCalled();
  });

  it('queues notice and reminder once for each remaining role', async () => {
    signingDeadlineAt = new Date(Date.now() + 2 * 3_600_000);
    const recipient = { recipientId: 101, signingStatus: 'SIGNED', completedAt: new Date().toISOString() };
    await service.applySignedRecipients('contract-1', [recipient], 'test');
    await service.applySignedRecipients('contract-1', [recipient], 'test');
    expect(queueNotices).toHaveBeenCalledTimes(1);
    const jobs = queueNotices.mock.calls[0][0].data;
    expect(jobs.filter(job => job.kind === 'OPEN')).toHaveLength(3);
    expect(jobs.filter(job => job.kind === 'REMINDER')).toHaveLength(3);
  });

  it('handleWebhook(): từ chối HTTP 401 khi sai hoặc thiếu X-Documenso-Secret', async () => {
    await expect(
      service.handleWebhook('wrong_secret', { event: 'DOCUMENT_SIGNED' }, '127.0.0.1'),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('handleWebhook(): ghi nhận Bên A qua DOCUMENT_SIGNED và bỏ qua khi trùng lặp', async () => {
    const res1 = await service.handleWebhook(
      'whsec_test_secret',
      {
        event: 'DOCUMENT_SIGNED',
        payload: {
          envelopeId: 'envelope_1',
          recipients: [
            { id: 101, role: 'SIGNER', signingStatus: 'SIGNED', signedAt: '2026-11-15T00:00:00Z' },
          ],
        },
      },
      '127.0.0.1',
    );
    expect(res1).toEqual({ ok: true, contractId: 'contract-1' });
    expect(signatureCreateMock).toHaveBeenCalledTimes(1);

    // Gọi lại lần 2 → idempotent, không tạo thêm chữ ký
    const res2 = await service.handleWebhook(
      'whsec_test_secret',
      {
        event: 'DOCUMENT_SIGNED',
        payload: {
          envelopeId: 'envelope_1',
          recipients: [
            { id: 101, role: 'SIGNER', signingStatus: 'SIGNED', signedAt: '2026-11-15T00:00:00Z' },
          ],
        },
      },
      '127.0.0.1',
    );
    expect(res2).toEqual({ ok: true, contractId: 'contract-1' });
    expect(signatureCreateMock).toHaveBeenCalledTimes(1);
  });

  it('chặn ghi nhận B/C/D trước khi FAMILY_REP ký', async () => {
    const result = await service.applySignedRecipients(
      'contract-1',
      [{ recipientId: 102, signingStatus: 'SIGNED', completedAt: '2026-11-15T00:00:00Z' }],
      '127.0.0.1',
    );

    expect(result.signedRoles).toEqual([]);
    expect(signatureCreateMock).not.toHaveBeenCalled();
  });

  it('applySignedRecipients(): trả signedPdfUrl = null khi mới có 1/4 chữ ký', async () => {
    const result = await service.applySignedRecipients(
      'contract-1',
      [
        { recipientId: 101, signingStatus: 'SIGNED', completedAt: '2026-11-15T00:00:00Z' },
      ],
      '127.0.0.1',
    );

    expect(result.signedRoles).toEqual(['FAMILY_REP']);
    expect(result.contractStatus).toBe('PENDING_APPROVAL');
    expect(result.signedPdfUrl).toBeNull();
    expect(paymentNoticeMock.sendPaymentNotice).not.toHaveBeenCalled();
  });

  it('applySignedRecipients(): giữ PENDING_APPROVAL và trả signedPdfUrl = null khi mới có 3/4 chữ ký', async () => {
    existingSignatures = [
      { signerRole: 'FAMILY_REP' },
      { signerRole: 'HEALTHCARE_FACILITY' },
      { signerRole: 'ASSIGNED_DOCTOR' },
    ];

    const result = await service.applySignedRecipients(
      'contract-1',
      [
        { recipientId: 101, signingStatus: 'SIGNED', completedAt: '2026-11-15T00:00:00Z' },
        { recipientId: 102, signingStatus: 'SIGNED', completedAt: '2026-11-15T00:01:00Z' },
        { recipientId: 103, signingStatus: 'SIGNED', completedAt: '2026-11-15T00:02:00Z' },
        { recipientId: 104, signingStatus: 'NOT_SIGNED' },
      ],
      '127.0.0.1',
    );

    expect(result.signedRoles).toHaveLength(3);
    expect(result.contractStatus).toBe('PENDING_APPROVAL');
    expect(result.signedPdfUrl).toBeNull();
    expect(paymentNoticeMock.sendPaymentNotice).not.toHaveBeenCalled();
  });

  it('syncContractFromDocumenso(): giữ PENDING_APPROVAL và trả signedPdfUrl = null khi hợp đồng chưa đủ 4/4 chữ ký', async () => {
    jest.spyOn(client, 'getEnvelope').mockResolvedValue({
      id: 'envelope_1',
      status: 'PENDING',
      title: 'Contract',
      envelopeItems: [{ id: 'item_1' }],
      recipients: [
        { id: 101, email: 'a@test.com', name: 'A', token: 't1', role: 'SIGNER', signingStatus: 'SIGNED', signedAt: '2026-11-15T00:00:00Z' },
        { id: 102, email: 'b@test.com', name: 'B', token: 't2', role: 'SIGNER', signingStatus: 'SIGNED', signedAt: '2026-11-15T00:01:00Z' },
        { id: 103, email: 'c@test.com', name: 'C', token: 't3', role: 'SIGNER', signingStatus: 'SIGNED', signedAt: '2026-11-15T00:02:00Z' },
        { id: 104, email: 'd@test.com', name: 'D', token: 't4', role: 'SIGNER', signingStatus: 'NOT_SIGNED' },
      ],
    });

    const result = await service.syncContractFromDocumenso('contract-1', '127.0.0.1');

    expect(result.signedRoles).toHaveLength(3);
    expect(result.contractStatus).toBe('PENDING_APPROVAL');
    expect(result.signedPdfUrl).toBeNull();
    expect(paymentNoticeMock.sendPaymentNotice).not.toHaveBeenCalled();
  });

  it('syncContractFromDocumenso(): gọi getEnvelope và ghi nhận đủ 4 chữ ký -> PENDING_PAYMENT + gửi mail VietQR', async () => {
    jest.spyOn(client, 'getEnvelope').mockResolvedValue({
      id: 'envelope_1',
      status: 'COMPLETED',
      title: 'Contract',
      envelopeItems: [{ id: 'item_1' }],
      recipients: [
        { id: 101, email: 'a@test.com', name: 'A', token: 't1', role: 'SIGNER', signingStatus: 'SIGNED', signedAt: '2026-11-15T00:00:00Z' },
        { id: 102, email: 'b@test.com', name: 'B', token: 't2', role: 'SIGNER', signingStatus: 'SIGNED', signedAt: '2026-11-15T00:01:00Z' },
        { id: 103, email: 'c@test.com', name: 'C', token: 't3', role: 'SIGNER', signingStatus: 'SIGNED', signedAt: '2026-11-15T00:02:00Z' },
        { id: 104, email: 'd@test.com', name: 'D', token: 't4', role: 'SIGNER', signingStatus: 'SIGNED', signedAt: '2026-11-15T00:03:00Z' },
      ],
    });

    const result = await service.syncContractFromDocumenso('contract-1', '127.0.0.1');

    expect(result.contractStatus).toBe('PENDING_PAYMENT');
    expect(result.signedRoles).toHaveLength(4);
    expect(result.signedPdfUrl).toBe('/api/v1/contracts/medical/contract-1/signed-pdf');
    expect(paymentNoticeMock.sendPaymentNotice).toHaveBeenCalledWith('contract-1');
  });

  describe('syncContractIfNeeded()', () => {
    const signedEnvelope = {
      id: 'envelope_1',
      status: 'PENDING',
      title: 'Contract',
      envelopeItems: [{ id: 'item_1' }],
      recipients: [
        { id: 101, email: 'a@test.com', name: 'A', token: 't1', role: 'SIGNER', signingStatus: 'SIGNED', signedAt: '2026-11-15T00:00:00Z' },
        { id: 102, email: 'b@test.com', name: 'B', token: 't2', role: 'SIGNER', signingStatus: 'NOT_SIGNED' },
        { id: 103, email: 'c@test.com', name: 'C', token: 't3', role: 'SIGNER', signingStatus: 'NOT_SIGNED' },
        { id: 104, email: 'd@test.com', name: 'D', token: 't4', role: 'SIGNER', signingStatus: 'NOT_SIGNED' },
      ],
    };

    it('trong khoảng cooldown không gọi lại Documenso', async () => {
      const getEnvelopeSpy = jest
        .spyOn(client, 'getEnvelope')
        .mockResolvedValue(signedEnvelope as any);

      const first = await service.syncContractIfNeeded('contract-1');
      const second = await service.syncContractIfNeeded('contract-1');

      expect(first?.contractId).toBe('contract-1');
      expect(second).toBeNull();
      expect(getEnvelopeSpy).toHaveBeenCalledTimes(1);
    });

    it('force: true bỏ qua cooldown và gọi Documenso ngay', async () => {
      const getEnvelopeSpy = jest
        .spyOn(client, 'getEnvelope')
        .mockResolvedValue(signedEnvelope as any);

      await service.syncContractIfNeeded('contract-1');
      const forced = await service.syncContractIfNeeded('contract-1', {
        force: true,
      });

      expect(forced?.contractId).toBe('contract-1');
      expect(getEnvelopeSpy).toHaveBeenCalledTimes(2);
    });

    it('gộp hai lời gọi đồng thời cùng hợp đồng thành một lần getEnvelope', async () => {
      const getEnvelopeSpy = jest
        .spyOn(client, 'getEnvelope')
        .mockResolvedValue(signedEnvelope as any);

      const [a, b] = await Promise.all([
        service.syncContractIfNeeded('contract-1'),
        service.syncContractIfNeeded('contract-1'),
      ]);

      expect(getEnvelopeSpy).toHaveBeenCalledTimes(1);
      expect(a).not.toBeNull();
      expect(b).not.toBeNull();
      expect(a?.contractId).toBe(b?.contractId);
    });

    it('fail-open: lỗi Documenso không ném ra ngoài mà trả null', async () => {
      jest
        .spyOn(client, 'getEnvelope')
        .mockRejectedValue(new Error('Documenso timeout'));

      await expect(service.syncContractIfNeeded('contract-1')).resolves.toBeNull();
    });
  });

  it('handleWebhook() & syncContractFromDocumenso(): bỏ qua an toàn khi hợp đồng đã TERMINATED hoặc EXPIRED', async () => {
    const prisma: any = {
      medicalContract: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'contract-term',
          contractStatus: 'TERMINATED',
        }),
        findUnique: jest.fn().mockResolvedValue({
          id: 'contract-exp',
          contractStatus: 'EXPIRED',
          documensoEnvelopeId: 'env-exp',
          documensoItemId: 'item-exp',
          signatures: [],
        }),
      },
      $transaction: jest.fn(),
    };
    const client = new DocumensoClientService();
    jest.spyOn(client, 'verifyWebhookSecret').mockReturnValue(true);
    const getEnvelopeSpy = jest.spyOn(client, 'getEnvelope');
    const svc = new DocumensoSyncService(prisma, client);

    const webhookRes = await svc.handleWebhook(
      'secret-123',
      {
        event: 'DOCUMENT_SIGNED',
        payload: {
          envelopeId: 'env-term',
          recipients: [{ id: 101, signingStatus: 'SIGNED' }],
        },
      },
      '127.0.0.1',
    );
    expect(webhookRes).toEqual({ ok: true, ignored: true });
    expect(prisma.$transaction).not.toHaveBeenCalled();

    const syncRes = await svc.syncContractFromDocumenso('contract-exp', '127.0.0.1');
    expect(syncRes).toEqual({
      synced: false,
      contractId: 'contract-exp',
      contractStatus: 'EXPIRED',
      signedRoles: [],
      signedPdfUrl: null,
    });
    expect(getEnvelopeSpy).not.toHaveBeenCalled();
  });
});
