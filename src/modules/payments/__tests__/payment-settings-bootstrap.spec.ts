import { ConflictException, Logger } from '@nestjs/common';
import { PaymentsConfig } from '../payments.config';
import { SePayReconciliationConfig } from '../sepay/sepay-reconciliation.config';
import { PaymentSettingsBootstrapService } from '../settings/payment-settings-bootstrap.service';
import { PaymentSettingsService } from '../settings/payment-settings.service';
import type { PaymentSettingsRepository } from '../settings/payment-settings.repository';
import type { PaymentSettingsSnapshot } from '../settings/payment-settings.dto';
import type { PrismaService } from '../../../core/database/prisma.service';

describe('PaymentSettingsBootstrapService & assertLegacyMapping', () => {
  const savedEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...savedEnv };
    jest.restoreAllMocks();
  });

  const makeLegacySnapshot = (): PaymentSettingsSnapshot => ({
    environment: 'LIVE',
    revision: 0,
    revisionId: null,
    monitoredAccountId: null,
    accountNumber: '68061220049999',
    gateway: 'MBbank',
    ttlMinutes: 15,
    bankAccountId: '11111111-1111-4111-8111-111111111111',
    apiToken: 'live-api-token',
    authMethod: 'hmac',
    webhookSecret: 'a'.repeat(32),
  });

  const makeService = () => {
    const repository = {
      current: jest.fn().mockResolvedValue(null),
      bootstrap: jest.fn().mockResolvedValue(null),
    } as unknown as PaymentSettingsRepository;
    const service = new PaymentSettingsService(
      repository,
      new PaymentsConfig(),
      new SePayReconciliationConfig(),
    );
    return { service, repository };
  };

  it('assertLegacyMapping only queries PENDING invoices and allows bootstrap when no PENDING mismatch exists', async () => {
    const { service } = makeService();
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = { invoice: { findMany } } as unknown as PrismaService;

    await expect(
      service.assertLegacyMapping(prisma, 'LIVE', null),
    ).resolves.toBeUndefined();

    expect(findMany).toHaveBeenCalledWith({
      where: { environment: 'LIVE', paymentStatus: 'PENDING' },
      distinct: ['expectedAccountNumber', 'expectedGateway'],
      select: { expectedAccountNumber: true, expectedGateway: true },
    });
  });

  it('assertLegacyMapping still throws LEGACY_ACCOUNT_UNCONFIGURED when a PENDING invoice mismatches or legacy is null', async () => {
    const { service } = makeService();
    const findMany = jest.fn().mockResolvedValue([
      {
        expectedAccountNumber: '102876301922',
        expectedGateway: 'Vietinbank',
      },
    ]);
    const prisma = { invoice: { findMany } } as unknown as PrismaService;

    await expect(
      service.assertLegacyMapping(prisma, 'LIVE', null),
    ).rejects.toThrow(new ConflictException('LEGACY_ACCOUNT_UNCONFIGURED'));

    await expect(
      service.assertLegacyMapping(prisma, 'LIVE', makeLegacySnapshot()),
    ).rejects.toThrow(new ConflictException('LEGACY_ACCOUNT_UNCONFIGURED'));
  });

  it('onModuleInit logs a warning and skips bootstrap instead of crashing when legacy env is incomplete and no PENDING invoices exist', async () => {
    process.env.PAYMENTS_MODE = 'live';
    process.env.PAYMENTS_EXPECTED_ACCOUNT = '68061220049999';
    process.env.PAYMENTS_EXPECTED_GATEWAY = 'MBbank';
    process.env.SEPAY_WEBHOOK_AUTH = 'hmac';
    process.env.SEPAY_WEBHOOK_SECRET = 'a'.repeat(32);
    delete process.env.SEPAY_BANK_ACCOUNT_ID_LIVE;
    delete process.env.SEPAY_API_TOKEN_LIVE;

    const { service, repository } = makeService();
    const prisma = {
      invoice: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaService;
    const warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    const bootstrapper = new PaymentSettingsBootstrapService(service, prisma);
    await expect(bootstrapper.onModuleInit()).resolves.toBeUndefined();

    expect(repository.bootstrap).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('SEPAY_BANK_ACCOUNT_ID_LIVE'),
    );
  });

  it('onModuleInit calls repository.bootstrap when legacy env is complete and PENDING invoices match', async () => {
    process.env.PAYMENTS_MODE = 'live';
    process.env.PAYMENTS_EXPECTED_ACCOUNT = '68061220049999';
    process.env.PAYMENTS_EXPECTED_GATEWAY = 'MBbank';
    process.env.SEPAY_WEBHOOK_AUTH = 'hmac';
    process.env.SEPAY_WEBHOOK_SECRET = 'a'.repeat(32);
    process.env.SEPAY_BANK_ACCOUNT_ID_LIVE =
      '11111111-1111-4111-8111-111111111111';
    process.env.SEPAY_API_TOKEN_LIVE = 'live-api-token';

    const { service, repository } = makeService();
    const prisma = {
      invoice: {
        findMany: jest.fn().mockResolvedValue([
          {
            expectedAccountNumber: '68061220049999',
            expectedGateway: 'mbbank',
          },
        ]),
      },
    } as unknown as PrismaService;

    const bootstrapper = new PaymentSettingsBootstrapService(service, prisma);
    await expect(bootstrapper.onModuleInit()).resolves.toBeUndefined();

    expect(repository.bootstrap).toHaveBeenCalledTimes(1);
    expect(repository.bootstrap).toHaveBeenCalledWith(
      expect.objectContaining({
        environment: 'LIVE',
        accountNumber: '68061220049999',
        gateway: 'MBbank',
        bankAccountId: '11111111-1111-4111-8111-111111111111',
        apiToken: 'live-api-token',
      }),
    );
  });
});
