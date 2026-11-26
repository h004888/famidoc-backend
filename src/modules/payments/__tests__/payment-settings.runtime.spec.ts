import { createHmac } from 'node:crypto';
import type { ExecutionContext } from '@nestjs/common';
import { SePayWebhookGuard } from '../guards/sepay-webhook.guard';
import { PaymentsConfig } from '../payments.config';
import { PaymentsClock } from '../payments.clock';
import { PaymentsServiceImpl } from '../services/impl/payments.service.impl';
import { InMemoryPaymentsRepository } from '../repositories/impl/in-memory-payments.repository';
import {
  BillingContractStatus,
  type BillingContract,
} from '../entities/payment.entity';
import type { PaymentSettingsService } from '../settings/payment-settings.service';
import { QuotaPeriod } from '../../care-packages/entities/care-package.entity';
import { randomUUID } from 'node:crypto';

describe('Snapshot webhook authentication', () => {
  const saved = { ...process.env };
  afterAll(() => {
    process.env = saved;
  });
  it('authenticates rotated account credentials and binds only verified account context', async () => {
    process.env.NODE_ENV = 'development';
    process.env.PAYMENTS_MODE = 'simulation';
    process.env.SEPAY_WEBHOOK_SECRET = 'wrong-env-secret'.repeat(3);
    const secret = 'database-key'.repeat(4),
      now = new Date();
    const rawBody = Buffer.from(
      '{"accountNumber":"0012345","gateway":"MBBank","content":"bí mật"}',
    );
    const timestamp = String(Math.floor(now.getTime() / 1000));
    const request = {
      path: '/api/v1/payments/webhook/vietqr',
      body: JSON.parse(rawBody.toString()),
      rawBody,
      headers: {
        'content-type': 'application/json',
        'x-sepay-timestamp': timestamp,
        'x-sepay-signature': `sha256=${createHmac('sha256', secret).update(timestamp).update('.').update(rawBody).digest('hex')}`,
      },
    };
    const settings = {
      repository: {
        credentials: jest
          .fn()
          .mockResolvedValue([
            {
              environment: 'TEST',
              monitoredAccountId: 'account-a',
              authMethod: 'hmac',
              webhookSecret: secret,
            },
          ]),
        current: jest.fn().mockResolvedValue({ revision: 1 }),
      },
    };
    const guard = Reflect.construct(SePayWebhookGuard, [
      new PaymentsConfig(),
      { now: () => now } as PaymentsClock,
      settings,
    ]) as SePayWebhookGuard;
    await expect(
      guard.canActivate({
        switchToHttp: () => ({ getRequest: () => request }),
      } as ExecutionContext),
    ).resolves.toBe(true);
    expect(request).toHaveProperty('verifiedPaymentContext', {
      environment: 'TEST',
      monitoredAccountIds: ['account-a'],
    });
    request.body.accountNumber = '99999';
    settings.repository.credentials.mockResolvedValueOnce([]);
    await expect(
      guard.canActivate({
        switchToHttp: () => ({ getRequest: () => request }),
      } as ExecutionContext),
    ).rejects.toThrow();
  });
  it('pins A on reused requests while new requests use B and valid A money still matches', async () => {
    process.env.NODE_ENV = 'development';
    process.env.PAYMENTS_MODE = 'simulation';
    const repository = new InMemoryPaymentsRepository(),
      now = new Date();
    let destination = {
      accountNumber: '00123456789',
      gateway: 'MBBank',
      ttlMinutes: 15,
    };
    const settings = {
      resolveSnapshot: jest.fn(async () => destination),
    } as unknown as PaymentSettingsService;
    const service = new PaymentsServiceImpl(
      repository,
      new PaymentsConfig(),
      { now: () => now },
      undefined,
      settings,
    );
    const makeContract = (): BillingContract => ({
      id: randomUUID(),
      familyId: randomUUID(),
      payerDisplayName: 'Test',
      simulation: true,
      status: BillingContractStatus.PENDING,
      packageSnapshot: {
        package: {
          id: randomUUID(),
          code: 'TEST',
          version: 1,
          name: 'Test',
          durationMonths: 1,
        },
        members: {
          requestedCount: 1,
          includedCount: 1,
          additionalCount: 0,
          maxCount: 1,
        },
        pricing: {
          currency: 'VND',
          basePriceVnd: 100000,
          additionalMemberMonthlyPriceVnd: 0,
          additionalMemberTermPriceVnd: 0,
          additionalMembersTotalVnd: 0,
          totalPriceVnd: 100000,
        },
        benefits: {
          quotaPeriod: QuotaPeriod.PER_TERM,
          quotas: { homeVisits: 0, facilityVisits: 0, videoConsultations: 1 },
          sharedAcrossMembers: true,
        },
      },
      requirements: {
        familySigned: true,
        adminSigned: true,
        facilitySigned: true,
        doctorSigned: true,
        facilityId: randomUUID(),
        doctorId: randomUUID(),
        doctorVerified: true,
        panelCapacityAvailable: true,
      },
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      activeFrom: null,
      activeUntil: null,
    });
    const aContract = makeContract(),
      bContract = makeContract();
    await repository.transaction(async (tx) => {
      await tx.saveContract(aContract);
      await tx.saveContract(bContract);
    });
    const a = await service.createVietQRPayment(aContract.id);
    destination = { ...destination, accountNumber: '00987654321' };
    const reused = await service.createVietQRPayment(aContract.id);
    const b = await service.createVietQRPayment(bContract.id);
    expect(reused.id).toBe(a.id);
    expect(reused.expectedAccountNumber).toBe('00123456789');
    expect(b.expectedAccountNumber).toBe('00987654321');
    const result = await service.handleVietQRWebhook({
      id: 1234,
      gateway: a.expectedGateway,
      accountNumber: a.expectedAccountNumber,
      transactionDate: new Date(+now + 7 * 3600000)
        .toISOString()
        .slice(0, 19)
        .replace('T', ' '),
      code: a.paymentCode,
      content: a.paymentCode,
      transferType: 'in',
      transferAmount: a.amountVnd,
      referenceCode: 'REF-A',
    });
    expect(result.transaction.outcome).toBe('MATCHED');
  });
});
