import { ConflictException } from '@nestjs/common';
import { PrismaPaymentsSession } from '../repositories/impl/payments.repository.impl';
import { PaymentsServiceImpl } from '../services/impl/payments.service.impl';
import { PaymentsClock } from '../payments.clock';
import { PaymentsConfig } from '../payments.config';
import {
  BillingContractStatus,
  PaymentRequestStatus,
  TransactionOutcome,
  type BillingContract,
  type PaymentRequest,
} from '../entities/payment.entity';

describe('Payment Renewal Activation (Case A & Case B, R8–R9)', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'development';
    process.env.PAYMENTS_MODE = 'simulation';
    process.env.PAYMENTS_EXPECTED_ACCOUNT = '0000000000';
    process.env.PAYMENTS_EXPECTED_GATEWAY = 'TEST_BANK';
    process.env.PAYMENT_REQUEST_TTL_MINUTES = '15';
  });

  it('PrismaPaymentsSession.contractEntity & saveContract: kỳ gia hạn chỉ cần 1 chữ ký FAMILY_REP, loại trừ upgradedFromId khi đếm panel, hỗ trợ PENDING_ACTIVATION', async () => {
    const mockTx: any = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      medicalContract: {
        findUnique: jest.fn(),
        count: jest.fn().mockResolvedValue(2),
        update: jest.fn().mockResolvedValue({ id: 'ren-1' }),
      },
      b2bStaffingContract: {
        findFirst: jest.fn().mockResolvedValue({ id: 'b2b-1' }),
      },
      patient: {
        count: jest.fn().mockResolvedValue(2),
      },
      notification: {
        createMany: jest.fn().mockResolvedValue({ count: 3 }),
      },
      doctor: {
        update: jest.fn().mockResolvedValue({ id: 'doc-1' }),
      },
    };

    const row = {
      id: 'ren-1',
      familyId: 'fam-1',
      facilityId: 'fac-1',
      doctorId: 'doc-1',
      packageId: 'pkg-1',
      totalAmount: 3_500_000,
      memberCount: 2,
      isDemo: true,
      contractStatus: 'PENDING_PAYMENT',
      upgradedFromId: 'old-active-1',
      holdExpiresAt: new Date('2026-11-27T05:00:00.000Z'),
      startDate: new Date('2026-12-11T00:00:00.000Z'),
      endDate: new Date('2027-03-11T00:00:00.000Z'),
      createdAt: new Date('2026-11-26T05:00:00.000Z'),
      updatedAt: new Date('2026-11-26T05:00:00.000Z'),
      billingSnapshot: {
        package: { id: 'pkg-1', durationMonths: 3 },
        members: { requestedCount: 2 },
        pricing: { totalPriceVnd: 3_500_000 },
        benefits: { quotas: { homeVisits: 3, videoConsultations: 20 } },
        renewalConfirmation: { confirmedByUserId: 'u-fam-1' },
      },
      familyUnit: {
        representativeUserId: 'u-fam-1',
        status: 'ACTIVE',
        representativeUser: { fullName: 'Nguyễn Văn A' },
      },
      facility: {
        userId: 'u-fac-1',
        verificationStatus: 'ACTIVE',
        user: { status: 'ACTIVE' },
      },
      doctor: {
        id: 'doc-1',
        userId: 'u-doc-1',
        facilityId: 'fac-1',
        onboardingStatus: 'ACTIVE',
        maxPanelCapacity: 5,
        user: { status: 'ACTIVE' },
      },
      signatures: [
        {
          signerRole: 'FAMILY_REP',
          signerUserId: 'u-fam-1',
          signatureHash: 'sig-hash',
          termsHash: 'terms-hash',
          signerUser: { status: 'ACTIVE', role: 'FAMILY_REP' },
        },
      ],
    };

    mockTx.medicalContract.findUnique.mockResolvedValue(row);
    const session = new PrismaPaymentsSession(mockTx, 'TEST');
    const entity = await session.findContract('ren-1');

    expect(entity).not.toBeNull();
    expect((entity as any).upgradedFromId).toBe('old-active-1');
    expect(entity!.requirements.familySigned).toBe(true);
    expect(entity!.requirements.adminSigned).toBe(true);
    expect(entity!.requirements.facilitySigned).toBe(true);
    expect(entity!.requirements.doctorSigned).toBe(true);
    expect(entity!.requirements.contractTermValid).toBe(true);
    expect(mockTx.medicalContract.count).toHaveBeenCalledWith({
      where: {
        doctorId: 'doc-1',
        contractStatus: 'ACTIVE',
        id: { notIn: ['ren-1', 'old-active-1'] },
      },
    });

    await session.saveContract({
      ...entity!,
      status: (BillingContractStatus as any).PENDING_ACTIVATION,
    });
    expect(mockTx.medicalContract.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ren-1' },
        data: expect.objectContaining({
          contractStatus: 'PENDING_ACTIVATION',
          holdExpiresAt: null,
        }),
      }),
    );
    expect(mockTx.notification.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            title: 'Hợp đồng đã được gia hạn',
            type: 'CONTRACT_RENEWED',
          }),
        ]),
      }),
    );
  });

  it('PaymentsServiceImpl: cắt expiresAt theo holdExpiresAt (R9), Case A -> PENDING_ACTIVATION, Case B -> ACTIVE ngay', async () => {
    const now = new Date('2026-11-26T05:00:00.000Z');
    const clock = new PaymentsClock();
    clock.now = () => new Date(now);

    const baseContract: BillingContract = {
      id: 'ren-case-a',
      familyId: 'fam-1',
      payerDisplayName: 'Nguyễn Văn A',
      simulation: true,
      status: BillingContractStatus.PENDING,
      upgradedFromId: 'old-active-1',
      holdExpiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(), // 5 phút < 15 phút TTL
      packageSnapshot: {
        package: {
          id: 'pkg-1',
          code: 'GOI_3_THANG',
          version: 1,
          name: 'Gói 3 tháng',
          description: 'Mô tả',
          durationMonths: 3,
          priceVnd: 3_500_000,
          includedMembers: 4,
          maxMembers: 6,
          additionalMemberMonthlyPriceVnd: 200_000,
          quotaPeriod: 'PER_TERM' as any,
          quotas: { homeVisits: 3, videoConsultations: 20, facilityVisits: 0 },
          currency: 'VND',
          status: 'ACTIVE' as any,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
          publishedAt: now.toISOString(),
          retiredAt: null,
        },
        members: {
          requestedCount: 2,
          includedCount: 4,
          additionalCount: 0,
          maxAllowedCount: 6,
        },
        pricing: {
          basePriceVnd: 3_500_000,
          additionalMembersTotalVnd: 0,
          totalPriceVnd: 3_500_000,
          currency: 'VND',
        },
        benefits: {
          quotas: { homeVisits: 3, videoConsultations: 20, facilityVisits: 0 },
          quotaPeriod: 'PER_TERM' as any,
          unlimitedMessaging: true,
        },
      },
      requirements: {
        familySigned: true,
        adminSigned: true,
        facilitySigned: true,
        doctorSigned: true,
        facilityId: 'fac-1',
        doctorId: 'doc-1',
        doctorVerified: true,
        panelCapacityAvailable: true,
        contractTermValid: true,
        familyCoverageComplete: true,
      },
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      activeFrom: null,
      activeUntil: null,
      plannedFrom: '2026-12-11T00:00:00.000Z',
      plannedUntil: '2027-03-11T00:00:00.000Z',
    };

    const requests: PaymentRequest[] = [];
    const savedContracts: BillingContract[] = [
      baseContract,
      {
        ...baseContract,
        id: 'old-active-1',
        status: BillingContractStatus.ACTIVE,
        upgradedFromId: null,
      },
    ];

    const session: any = {
      findContract: jest.fn((id: string) =>
        Promise.resolve(savedContracts.find((c) => c.id === id) ?? null),
      ),
      listContracts: jest.fn(() => Promise.resolve(savedContracts)),
      saveContract: jest.fn((c: BillingContract) => {
        const idx = savedContracts.findIndex((x) => x.id === c.id);
        if (idx >= 0) savedContracts[idx] = { ...c };
        return Promise.resolve();
      }),
      listRequests: jest.fn((cid: string) =>
        Promise.resolve(requests.filter((r) => r.contractId === cid)),
      ),
      saveRequest: jest.fn((r: PaymentRequest) => {
        const idx = requests.findIndex((x) => x.id === r.id);
        if (idx >= 0) requests[idx] = { ...r };
        else requests.push({ ...r });
        return Promise.resolve();
      }),
      findRequest: jest.fn((id: string) =>
        Promise.resolve(requests.find((r) => r.id === id) ?? null),
      ),
      findRequestByCode: jest.fn((code: string) =>
        Promise.resolve(requests.find((r) => r.paymentCode === code) ?? null),
      ),
      nextPaymentNumber: jest.fn().mockResolvedValue(1),
      findTransactionByProviderId: jest.fn().mockResolvedValue(null),
      findTransactionByWebhookId: jest.fn().mockResolvedValue(null),
      findTransactionByApiId: jest.fn().mockResolvedValue(null),
      findTransactionByBankReference: jest.fn().mockResolvedValue(null),
      findTransactionByBankIdentity: jest.fn().mockResolvedValue(null),
      findTransactionByReference: jest.fn().mockResolvedValue(null),
      findMatchedByBankReference: jest.fn().mockResolvedValue(null),
      saveTransaction: jest.fn().mockResolvedValue(undefined),
      findLatestTransactionByRequestId: jest.fn().mockResolvedValue(null),
      updateRequestStatus: jest.fn().mockResolvedValue(undefined),
    };

    const repository: any = {
      transaction: (work: any) => work(session),
    };
    const service = new PaymentsServiceImpl(
      repository,
      new PaymentsConfig(),
      clock,
      undefined,
      {
        resolveSnapshot: jest.fn().mockResolvedValue({
          accountNumber: '0000000000',
          gateway: 'TEST_BANK',
          ttlMinutes: 15,
        }),
      } as any,
    );

    // 1. issuePayment cắt expiresAt <= holdExpiresAt (5 phút)
    const issued = await service.createVietQRPayment(
      'ren-case-a',
      undefined,
      { id: 'u-fam-1', role: 'FAMILY_REP', familyUnitId: 'fam-1' } as any,
    );
    expect(Date.parse(issued.expiresAt)).toBeLessThanOrEqual(
      Date.parse(baseContract.holdExpiresAt!),
    );

    // 2. Thanh toán MATCHED cho Case A -> PENDING_ACTIVATION + getPaymentStatus trả về AWAITING_START_DATE
    const webhookRes = await (service as any).handleIncomingTransaction({
      providerTransactionId: 'sepay:9001',
      gateway: 'TEST_BANK',
      accountNumber: '0000000000',
      transactionAt: new Date('2026-11-26T05:01:00.000Z'),
      code: issued.paymentCode,
      content: issued.transferContent,
      transferType: 'in',
      transferAmount: 3_500_000,
      referenceCode: 'FT-CASE-A',
      fingerprint: 'fp-case-a',
      source: 'WEBHOOK',
    });
    expect(webhookRes.transaction.outcome).toBe(TransactionOutcome.MATCHED);
    expect(webhookRes.activation?.status).toBe(
      (BillingContractStatus as any).PENDING_ACTIVATION,
    );
    expect(webhookRes.activation?.activated).toBe(false);
    expect(webhookRes.activation?.blockingReasons).toContain('AWAITING_START_DATE');

    const statusView = await service.getPaymentStatus(issued.id, {
      id: 'u-fam-1',
      role: 'FAMILY_REP',
      familyUnitId: 'fam-1',
    } as any);
    expect(statusView.status).toBe(PaymentRequestStatus.PAID);
    expect(statusView.activation).toEqual({
      activated: false,
      blockingReasons: ['AWAITING_START_DATE'],
    });

    // 3. Case B: plannedFrom <= todayInVietnam -> ACTIVE ngay (hợp đồng cũ đã EXPIRED)
    savedContracts[1].status = BillingContractStatus.CANCELLED;
    const caseB: BillingContract = {
      ...baseContract,
      id: 'ren-case-b',
      status: BillingContractStatus.PENDING,
      upgradedFromId: 'old-expired-1',
      holdExpiresAt: new Date(now.getTime() + 24 * 3600_000).toISOString(),
      plannedFrom: '2026-11-26T00:00:00.000Z',
      plannedUntil: '2027-02-26T00:00:00.000Z',
    };
    savedContracts.push(caseB);
    const issuedB = await service.createVietQRPayment(
      'ren-case-b',
      undefined,
      { id: 'u-fam-1', role: 'FAMILY_REP', familyUnitId: 'fam-1' } as any,
    );
    const webhookB = await (service as any).handleIncomingTransaction({
      providerTransactionId: 'sepay:9002',
      gateway: 'TEST_BANK',
      accountNumber: '0000000000',
      transactionAt: new Date('2026-11-26T05:02:00.000Z'),
      code: issuedB.paymentCode,
      content: issuedB.transferContent,
      transferType: 'in',
      transferAmount: 3_500_000,
      referenceCode: 'FT-CASE-B',
      fingerprint: 'fp-case-b',
      source: 'WEBHOOK',
    });
    expect(webhookB.activation?.status).toBe(BillingContractStatus.ACTIVE);
    expect(webhookB.activation?.activated).toBe(true);
  });
});
