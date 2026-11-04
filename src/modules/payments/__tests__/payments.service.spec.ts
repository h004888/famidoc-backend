import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CarePackagesServiceImpl } from '../../care-packages/services/impl/care-packages.service.impl';
import { QuotaPeriod } from '../../care-packages/entities/care-package.entity';
import { InMemoryCarePackagesRepository } from '../../care-packages/repositories/impl/in-memory-care-packages.repository';
import type { SePayWebhookDto } from '../dtos/sepay-webhook.dto';
import {
  BillingContractStatus,
  PaymentRequestStatus,
  TransactionOutcome,
  TransactionReason,
  type BillingContract,
  type PaymentRequest,
} from '../entities/payment.entity';
import { PaymentsClock } from '../payments.clock';
import { PaymentsConfig } from '../payments.config';
import { PaymentTestService as PaymentsServiceImpl } from './payment-test-fixture';
import { InMemoryPaymentsRepository } from '../repositories/impl/in-memory-payments.repository';

const variables = [
  'NODE_ENV',
  'PAYMENTS_MODE',
  'PAYMENTS_EXPECTED_ACCOUNT',
  'PAYMENTS_EXPECTED_GATEWAY',
  'PAYMENT_REQUEST_TTL_MINUTES',
];
const readyRequirements = () => ({
  familySigned: true,
  adminSigned: true,
  facilitySigned: true,
  doctorSigned: true,
  facilityId: randomUUID(),
  doctorId: randomUUID(),
  doctorVerified: true,
  panelCapacityAvailable: true,
});

// Ngày giao dịch trong payload dùng giờ Việt Nam đúng đến giây như SePay gửi.
const bankDate = (date: Date): string =>
  new Date(date.getTime() + 7 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ');

describe('PaymentsServiceImpl (simulation)', () => {
  let service: PaymentsServiceImpl;
  let packages: CarePackagesServiceImpl;
  let repository: InMemoryPaymentsRepository;
  let now: Date;
  let packageId: string;
  let saved: Record<string, string | undefined>;

  beforeEach(async () => {
    saved = Object.fromEntries(variables.map((key) => [key, process.env[key]]));
    process.env.NODE_ENV = 'development';
    process.env.PAYMENTS_MODE = 'simulation';
    process.env.PAYMENTS_EXPECTED_ACCOUNT = '0000000000';
    process.env.PAYMENTS_EXPECTED_GATEWAY = 'TEST_BANK';
    process.env.PAYMENT_REQUEST_TTL_MINUTES = '15';
    now = new Date('2026-10-27T01:00:00.000Z');
    const clock = new PaymentsClock();
    clock.now = () => new Date(now);
    repository = new InMemoryPaymentsRepository();
    packages = new CarePackagesServiceImpl(
      new InMemoryCarePackagesRepository(),
    );
    service = new PaymentsServiceImpl(
      repository,
      packages,
      new PaymentsConfig(),
      clock,
    );
    // Giá giả: 100.000/1 tháng/2 người, thêm người 50.000/tháng, tối đa 4 người.
    const item = await packages.create({
      code: 'DEMO',
      name: 'Demo',
      durationMonths: 1,
      priceVnd: 100_000,
      includedMembers: 2,
      maxMembers: 4,
      additionalMemberMonthlyPriceVnd: 50_000,
      quotaPeriod: QuotaPeriod.PER_TERM,
      quotas: { videoConsultations: 5, homeVisits: 0, facilityVisits: 0 },
    });
    await packages.publish(item.id);
    packageId = item.id;
  });

  afterEach(() => {
    for (const key of variables) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  async function readyContract(
    familyId = randomUUID(),
  ): Promise<BillingContract> {
    const contract = await service.createDemoContract({
      familyId,
      packageId,
      memberCount: 3,
    });
    await service.updateDemoRequirements(contract.id, readyRequirements());
    return service.getContract(contract.id);
  }

  async function pendingPayment(
    familyId = randomUUID(),
  ): Promise<PaymentRequest> {
    return service.createVietQRPayment((await readyContract(familyId)).id);
  }

  function payload(
    payment: PaymentRequest,
    overrides: Partial<SePayWebhookDto> = {},
  ): SePayWebhookDto {
    return {
      id: 1,
      gateway: 'TEST_BANK',
      accountNumber: '0000000000',
      transactionDate: bankDate(now),
      code: payment.paymentCode,
      content: payment.transferContent ?? payment.paymentCode,
      transferType: 'in',
      transferAmount: payment.amountVnd,
      referenceCode: 'TEST_REF_1',
      ...overrides,
    };
  }

  it('fails closed when simulation is not explicitly enabled', async () => {
    delete process.env.PAYMENTS_MODE;
    await expect(
      service.createDemoContract({
        familyId: randomUUID(),
        packageId,
        memberCount: 2,
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('creates an unpaid contract with all requirements false and a server-calculated snapshot', async () => {
    const contract = await service.createDemoContract({
      familyId: randomUUID(),
      packageId,
      memberCount: 3,
    });
    expect(contract.simulation).toBe(true);
    expect(contract.packageSnapshot.pricing.totalPriceVnd).toBe(150_000);
    const result = await service.tryActivate(contract.id);
    expect(result.activated).toBe(false);
    expect(result.blockingReasons).toContain('VERIFIED_PAYMENT_REQUIRED');
    expect(result.blockingReasons).toContain('ADMIN_SIGNATURE_REQUIRED');
    await expect(
      service.createVietQRPayment(contract.id),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('requires a valid configured test destination', async () => {
    const contract = await readyContract();
    process.env.PAYMENTS_EXPECTED_ACCOUNT = '';
    await expect(
      service.createVietQRPayment(contract.id),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('creates only one live request per contract, even for concurrent calls', async () => {
    const contract = await readyContract();
    const [a, b] = await Promise.all([
      service.createVietQRPayment(contract.id),
      service.createVietQRPayment(contract.id),
    ]);
    expect(a.id).toBe(b.id);
    expect(a.amountVnd).toBe(150_000);
    expect(a.paymentCode).toMatch(/^FD[0-9]{6}$/);
    expect(a.transferContent).toBe(`NGUYEN HOAI NAM - ${a.paymentCode}`);
    expect(Date.parse(a.expiresAt) - Date.parse(a.createdAt)).toBe(15 * 60_000);
  });

  it('keeps agreed snapshot prices after the catalog publishes a newer version', async () => {
    const contract = await readyContract();
    const second = await packages.createVersion(packageId);
    await packages.update(second.id, { priceVnd: 200_000 });
    await packages.publish(second.id);
    const payment = await service.createVietQRPayment(contract.id);
    expect(payment.amountVnd).toBe(150_000);
    expect(
      (await service.getContract(contract.id)).packageSnapshot.package.version,
    ).toBe(1);
  });

  it('expires a request and allocates a different code for its next attempt', async () => {
    const old = await pendingPayment();
    now = new Date(now.getTime() + 16 * 60_000);
    expect((await service.getPaymentStatus(old.id)).status).toBe(
      PaymentRequestStatus.EXPIRED,
    );
    const next = await service.createVietQRPayment(old.contractId);
    expect(next.attempt).toBe(2);
    expect(next.paymentCode).not.toBe(old.paymentCode);
    expect((await service.getPaymentStatus(old.id)).status).toBe(
      PaymentRequestStatus.EXPIRED,
    );
  });

  it('records valid funds and activates with the contracted benefits', async () => {
    const payment = await pendingPayment();
    const result = await service.handleVietQRWebhook(payload(payment));
    expect(result.transaction.outcome).toBe(TransactionOutcome.MATCHED);
    expect(result.activation?.activated).toBe(true);
    const contract = await service.getContract(payment.contractId);
    expect(contract.status).toBe(BillingContractStatus.ACTIVE);
    expect(contract.activeFrom).toBe(now.toISOString());
    expect(contract.activeUntil).toBe('2026-11-27T01:00:00.000Z');
    expect(contract.packageSnapshot.benefits.quotas.videoConsultations).toBe(5);
    expect(
      (await service.getPaymentStatus(payment.id)).acceptedTransactionId,
    ).toBe(result.transaction.id);
  });

  it('does not double-credit concurrent retries or extend dates on replay', async () => {
    const payment = await pendingPayment();
    const dto = payload(payment);
    const results = await Promise.all([
      service.handleVietQRWebhook(dto),
      service.handleVietQRWebhook(dto),
    ]);
    expect(results.filter((result) => result.duplicate)).toHaveLength(1);
    const original = await service.getContract(payment.contractId);
    now = new Date(now.getTime() + 60_000);
    expect((await service.handleVietQRWebhook(dto)).duplicate).toBe(true);
    expect(await service.getContract(payment.contractId)).toEqual(original);
    expect((await service.listTransactions({ page: 1, limit: 20 })).total).toBe(
      1,
    );
  });

  it('rejects reuse of a provider ID with altered payment data', async () => {
    const payment = await pendingPayment();
    await service.handleVietQRWebhook(payload(payment));
    await expect(
      service.handleVietQRWebhook(payload(payment, { transferAmount: 1 })),
    ).rejects.toBeInstanceOf(ConflictException);
    expect((await service.listTransactions({ page: 1, limit: 20 })).total).toBe(
      1,
    );
  });

  it.each([
    [{ transferAmount: 149_999 }, TransactionReason.AMOUNT_MISMATCH],
    [{ transferAmount: 150_001 }, TransactionReason.AMOUNT_MISMATCH],
    [{ accountNumber: '1111111111' }, TransactionReason.WRONG_ACCOUNT],
    [{ gateway: 'OTHER_BANK' }, TransactionReason.WRONG_ACCOUNT],
    [{ code: null, content: '' }, TransactionReason.MISSING_CODE],
    [
      { code: 'FD' + 'A'.repeat(32), content: '' },
      TransactionReason.UNKNOWN_CODE,
    ],
  ] as const)(
    'keeps a mismatched transfer for review: %j',
    async (changes, reason) => {
      const payment = await pendingPayment();
      const result = await service.handleVietQRWebhook(
        payload(payment, changes),
      );
      expect(result.transaction.reason).toBe(reason);
      expect(result.transaction.outcome).toBe(
        TransactionOutcome.REVIEW_REQUIRED,
      );
      expect((await service.getPaymentStatus(payment.id)).status).toBe(
        PaymentRequestStatus.PENDING,
      );
      expect((await service.getContract(payment.contractId)).status).toBe(
        BillingContractStatus.PENDING,
      );
    },
  );

  it('ignores outgoing money and does not use the account balance as payment evidence', async () => {
    const payment = await pendingPayment();
    const result = await service.handleVietQRWebhook(
      payload(payment, { transferType: 'out', accumulated: 1_000_000 }),
    );
    expect(result.transaction.outcome).toBe(TransactionOutcome.IGNORED);
    expect(result.transaction.reason).toBe(TransactionReason.OUTGOING_TRANSFER);
  });

  it('matches a complete token from content when code is null', async () => {
    const payment = await pendingPayment();
    const result = await service.handleVietQRWebhook(
      payload(payment, {
        code: null,
        content: `Thanh toan ${payment.paymentCode.toLowerCase()} dich vu`,
      }),
    );
    expect(result.transaction.outcome).toBe(TransactionOutcome.MATCHED);
  });

  it('does not match a code embedded inside another alphanumeric token', async () => {
    const payment = await pendingPayment();
    const result = await service.handleVietQRWebhook(
      payload(payment, { code: null, content: `X${payment.paymentCode}Y` }),
    );
    expect(result.transaction.reason).toBe(TransactionReason.MISSING_CODE);
  });

  it('refuses ambiguous references rather than picking a request', async () => {
    const payment = await pendingPayment();
    const result = await service.handleVietQRWebhook(
      payload(payment, {
        content: `${payment.paymentCode} FD${'A'.repeat(32)}`,
      }),
    );
    expect(result.transaction.reason).toBe(TransactionReason.AMBIGUOUS_CODE);
  });

  it('does not use the same bank reference for another provider transaction', async () => {
    const first = await pendingPayment();
    const second = await pendingPayment();
    await service.handleVietQRWebhook(payload(first));
    const result = await service.handleVietQRWebhook(
      payload(second, { id: 2 }),
    );
    expect(result.transaction.reason).toBe(
      TransactionReason.DUPLICATE_BANK_REFERENCE,
    );
    expect((await service.getPaymentStatus(second.id)).status).toBe(
      PaymentRequestStatus.PENDING,
    );
  });

  it('keeps a second distinct transfer to an already-paid code for review', async () => {
    const payment = await pendingPayment();
    await service.handleVietQRWebhook(payload(payment));
    const result = await service.handleVietQRWebhook(
      payload(payment, { id: 2, referenceCode: 'SECOND_TRANSFER' }),
    );
    expect(result.transaction.reason).toBe(TransactionReason.ALREADY_PAID);
    expect((await service.listTransactions({ page: 1, limit: 20 })).total).toBe(
      2,
    );
  });

  it('does not match transfers from before the request was created', async () => {
    const payment = await pendingPayment();
    const result = await service.handleVietQRWebhook(
      payload(payment, {
        transactionDate: bankDate(new Date(now.getTime() - 1000)),
      }),
    );
    expect(result.transaction.reason).toBe(TransactionReason.BEFORE_REQUEST);
  });

  it('flags a transaction timestamp too far in the future', async () => {
    const payment = await pendingPayment();
    const result = await service.handleVietQRWebhook(
      payload(payment, {
        transactionDate: bankDate(new Date(now.getTime() + 360_000)),
      }),
    );
    expect(result.transaction.reason).toBe(
      TransactionReason.FUTURE_TRANSACTION,
    );
  });

  it('accepts delayed delivery if the bank received payment within the deadline', async () => {
    const payment = await pendingPayment();
    const dto = payload(payment);
    now = new Date(now.getTime() + 16 * 60_000);
    expect((await service.getPaymentStatus(payment.id)).status).toBe(
      PaymentRequestStatus.EXPIRED,
    );
    const result = await service.handleVietQRWebhook(dto);
    expect(result.transaction.outcome).toBe(TransactionOutcome.MATCHED);
    expect(result.activation?.activated).toBe(true);
  });

  it('does not auto-accept an old code when a newer attempt already exists', async () => {
    const old = await pendingPayment();
    const dto = payload(old);
    now = new Date(now.getTime() + 16 * 60_000);
    await service.createVietQRPayment(old.contractId);
    expect((await service.handleVietQRWebhook(dto)).transaction.reason).toBe(
      TransactionReason.SUPERSEDED_REQUEST,
    );
  });

  it('flags funds received at or after the request deadline', async () => {
    const payment = await pendingPayment();
    now = new Date(payment.expiresAt);
    const result = await service.handleVietQRWebhook(payload(payment));
    expect(result.transaction.reason).toBe(TransactionReason.LATE_PAYMENT);
  });

  it('does not activate a cancelled request and never implements automatic refunds', async () => {
    const payment = await pendingPayment();
    await service.cancelRequest(payment.id);
    const result = await service.handleVietQRWebhook(payload(payment));
    expect(result.transaction.reason).toBe(TransactionReason.CANCELLED_REQUEST);
    expect((await service.getPaymentStatus(payment.id)).status).toBe(
      PaymentRequestStatus.CANCELLED,
    );
    expect(result.activation).toBeNull();
  });

  it('records money while waiting for changed requirements, then activates after they are restored', async () => {
    const payment = await pendingPayment();
    await service.updateDemoRequirements(payment.contractId, {
      doctorVerified: false,
    });
    const result = await service.handleVietQRWebhook(payload(payment));
    expect((await service.getPaymentStatus(payment.id)).status).toBe(
      PaymentRequestStatus.PAID,
    );
    expect(result.activation?.blockingReasons).toContain(
      'DOCTOR_VERIFICATION_REQUIRED',
    );
    expect((await service.getContract(payment.contractId)).status).toBe(
      BillingContractStatus.PENDING,
    );
    const restored = await service.updateDemoRequirements(payment.contractId, {
      doctorVerified: true,
    });
    expect(restored.activation.activated).toBe(true);
  });

  it('activates at most one contract per family under concurrent payment receipts', async () => {
    const familyId = randomUUID();
    const first = await pendingPayment(familyId);
    const second = await pendingPayment(familyId);
    const results = await Promise.all([
      service.handleVietQRWebhook(payload(first)),
      service.handleVietQRWebhook(
        payload(second, { id: 2, referenceCode: 'REF_2' }),
      ),
    ]);
    expect(
      results.filter((result) => result.activation?.activated),
    ).toHaveLength(1);
    expect(
      results.find((result) => !result.activation?.activated)?.activation
        ?.blockingReasons,
    ).toContain('FAMILY_ALREADY_HAS_ACTIVE_CONTRACT');
    expect((await service.getPaymentStatus(first.id)).status).toBe(
      PaymentRequestStatus.PAID,
    );
    expect((await service.getPaymentStatus(second.id)).status).toBe(
      PaymentRequestStatus.PAID,
    );
    const third = await readyContract(familyId);
    await expect(service.createVietQRPayment(third.id)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('cannot force activation, cancel paid requests or edit an active contract', async () => {
    const payment = await pendingPayment();
    expect(
      (await service.tryActivate(payment.contractId)).blockingReasons,
    ).toContain('VERIFIED_PAYMENT_REQUIRED');
    await service.handleVietQRWebhook(payload(payment));
    await expect(service.cancelRequest(payment.id)).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(
      service.cancelDemoContract(payment.contractId),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.updateDemoRequirements(payment.contractId, {
        doctorSigned: false,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('cancels an unpaid demo contract and all its outstanding requests', async () => {
    const payment = await pendingPayment();
    const cancelled = await service.cancelDemoContract(payment.contractId);
    expect(await service.cancelDemoContract(payment.contractId)).toEqual(
      cancelled,
    );
    expect((await service.getPaymentStatus(payment.id)).status).toBe(
      PaymentRequestStatus.CANCELLED,
    );
    expect(
      (await service.tryActivate(payment.contractId)).blockingReasons,
    ).toContain('CONTRACT_CANCELLED');
  });

  it('filters the transaction log and returns an empty later page', async () => {
    const payment = await pendingPayment();
    await service.handleVietQRWebhook(payload(payment, { transferAmount: 1 }));
    expect(
      (
        await service.listTransactions({
          page: 1,
          limit: 1,
          outcome: TransactionOutcome.REVIEW_REQUIRED,
        })
      ).total,
    ).toBe(1);
    expect(
      (await service.listTransactions({ page: 2, limit: 1 })).items,
    ).toEqual([]);
  });

  it('reports missing records without fabricating a contract or request', async () => {
    await expect(service.getPaymentStatus(randomUUID())).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.getContract(randomUUID())).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rolls back tentative writes if a transaction fails and releases the queue', async () => {
    const contract = await readyContract();
    await expect(
      repository.transaction(async (session) => {
        const item = (await session.findContract(contract.id))!;
        item.status = BillingContractStatus.CANCELLED;
        await session.saveContract(item);
        throw new Error('Simulated write failure');
      }),
    ).rejects.toThrow('Simulated write failure');
    expect((await service.getContract(contract.id)).status).toBe(
      BillingContractStatus.PENDING,
    );
    expect((await service.createVietQRPayment(contract.id)).status).toBe(
      PaymentRequestStatus.PENDING,
    );
  });

  it('does not expose mutable internal references', async () => {
    const contract = await readyContract();
    contract.packageSnapshot.pricing.totalPriceVnd = 1;
    expect(
      (await service.getContract(contract.id)).packageSnapshot.pricing
        .totalPriceVnd,
    ).toBe(150_000);
  });

  it('rejects an impossible calendar date without recording any transaction', async () => {
    const payment = await pendingPayment();
    await expect(
      service.handleVietQRWebhook(
        payload(payment, { transactionDate: '2026-02-30 08:00:00' }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect((await service.listTransactions({ page: 1, limit: 20 })).total).toBe(
      0,
    );
  });
  it('uses the full payment code in bank content when the provider extracts a shorter code', async () => {
    const payment = await pendingPayment();
    const result = await service.handleVietQRWebhook(
      payload(payment, { code: payment.paymentCode.slice(0, 10) }),
    );
    expect(result.transaction.outcome).toBe(TransactionOutcome.MATCHED);
  });

  it('fills the QR account, bank, invoice amount and unique transfer content on the server', async () => {
    const payment = await pendingPayment();
    expect(payment.qrUrl).toBeNull();
    process.env.PAYMENTS_MODE = 'sepay_test';
    const result = await service.getPaymentStatus(payment.id);
    const url = new URL(result.qrUrl!);
    expect(url.origin + url.pathname).toBe('https://vietqr.app/img');
    expect(url.searchParams.get('acc')).toBe(payment.expectedAccountNumber);
    expect(url.searchParams.get('bank')).toBe(payment.expectedGateway);
    expect(url.searchParams.get('amount')).toBe('150000');
    expect(url.searchParams.get('des')).toBe(
      `NGUYEN HOAI NAM - ${payment.paymentCode}`,
    );
    expect(result.status).toBe(PaymentRequestStatus.PENDING);
  });

  it('continues matching an existing 32-character code when SePay extracts only its first 24 characters', async () => {
    const payment = await pendingPayment();
    payment.paymentCode = 'FD' + '1234567890ABCDEF'.repeat(2);
    payment.transferContent = `NGUYEN HOAI NAM - ${payment.paymentCode}`;
    await repository.transaction((session) => session.saveRequest(payment));
    const result = await service.handleVietQRWebhook(
      payload(payment, {
        code: payment.paymentCode.slice(0, 26),
      }),
    );
    expect(result.transaction.outcome).toBe(TransactionOutcome.MATCHED);
    expect(result.activation?.activated).toBe(true);
  });

  it('does not accept a truncated code from an edited transfer description', async () => {
    const payment = await pendingPayment();
    const result = await service.handleVietQRWebhook(
      payload(payment, {
        content: payment.paymentCode + 'Z',
      }),
    );
    expect(result.transaction.reason).toBe(TransactionReason.MISSING_CODE);
    expect((await service.getPaymentStatus(payment.id)).status).toBe(
      PaymentRequestStatus.PENDING,
    );
  });
  it('keeps the original transfer name when the account name changes after issuing the QR', async () => {
    const payment = await pendingPayment();
    await repository.transaction(async (session) => {
      const contract = (await session.findContract(payment.contractId))!;
      contract.payerDisplayName = 'Tên mới sau khi tạo hóa đơn';
      await session.saveContract(contract);
    });
    const result = await service.getPaymentStatus(payment.id);
    expect(result.transferContent).toBe(
      `NGUYEN HOAI NAM - ${payment.paymentCode}`,
    );
  });
});
