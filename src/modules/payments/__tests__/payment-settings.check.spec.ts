import { SePayApiClient } from '../sepay/sepay-api.client';
import { SePayReconciliationConfig } from '../sepay/sepay-reconciliation.config';
import { ServiceUnavailableException } from '@nestjs/common';
import { PaymentSettingsCheckService } from '../settings/payment-settings-check.service';
import { PaymentSettingsCrypto } from '../settings/payment-settings.crypto';
import type { PaymentSettingsService } from '../settings/payment-settings.service';
import type { PrismaService } from '../../../core/database/prisma.service';
import type {
  PaymentSettingsSnapshot,
  PaymentSettingsDraftDto,
} from '../settings/payment-settings.dto';
describe('Draft credentials are isolated per SePay API call', () => {
  const original = global.fetch;
  afterEach(() => {
    global.fetch = original;
  });
  it('uses explicit draft token without mutating singleton config', async () => {
    const config = new SePayReconciliationConfig();
    jest.spyOn(config, 'getToken').mockReturnValue('saved-token');
    global.fetch = jest.fn(async (_url, init) => {
      expect(new Headers(init?.headers).get('authorization')).toBe(
        'Bearer draft-token',
      );
      return new Response(
        JSON.stringify({
          status: 'success',
          data: [],
          meta: { pagination: { has_more: false } },
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    const client = new SePayApiClient(config);
    const call = client.listTransactions.bind(client) as (
      ...args: unknown[]
    ) => Promise<unknown>;
    await expect(
      call(
        'TEST',
        {
          bankAccountId: '11111111-1111-4111-8111-111111111111',
          page: 1,
          perPage: 1,
        },
        { apiToken: 'draft-token' },
      ),
    ).resolves.toBeDefined();
    expect(config.getToken('TEST')).toBe('saved-token');
  });
});

describe('Draft check validation, fingerprint and safe provider results', () => {
  const oldKey = process.env.PAYMENT_SETTINGS_ENCRYPTION_KEY;
  const snapshot: PaymentSettingsSnapshot = {
    environment: 'TEST',
    revision: 1,
    revisionId: null,
    monitoredAccountId: null,
    gateway: 'MBBank',
    accountNumber: '00123456789',
    bankAccountId: '11111111-1111-4111-8111-111111111111',
    authMethod: 'hmac',
    apiToken: 'private-token',
    webhookSecret: 'private-key'.repeat(4),
    ttlMinutes: 15,
  };
  const settings = { resolveDraft: jest.fn(async () => snapshot) };
  const api = { listTransactions: jest.fn() },
    limiter = { deleteMany: jest.fn(), upsert: jest.fn() };
  const service = new PaymentSettingsCheckService(
    settings as unknown as PaymentSettingsService,
    { paymentConfigurationCheckWindow: limiter } as unknown as PrismaService,
    api as unknown as SePayApiClient,
    new PaymentSettingsCrypto(),
    { now: () => new Date('2026-11-25T10:00:00Z') },
  );
  beforeEach(() => {
    process.env.PAYMENT_SETTINGS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString(
      'base64',
    );
    jest.clearAllMocks();
    settings.resolveDraft.mockResolvedValue(snapshot);
    limiter.upsert.mockResolvedValue({ count: 1 });
    api.listTransactions.mockResolvedValue({ transactions: [] });
  });
  afterAll(() => {
    if (oldKey === undefined)
      delete process.env.PAYMENT_SETTINGS_ENCRYPTION_KEY;
    else process.env.PAYMENT_SETTINGS_ENCRYPTION_KEY = oldKey;
  });
  it.each([
    ['SePay API returned HTTP 401', 'AUTH_REJECTED'],
    ['SePay API returned HTTP 403', 'AUTH_REJECTED'],
    ['SePay API returned HTTP 429', 'RATE_LIMITED'],
    ['SePay API returned HTTP 503', 'PROVIDER_UNAVAILABLE'],
    ['SePay API returned invalid JSON', 'MALFORMED_RESPONSE'],
    ['SePay API response is malformed', 'MALFORMED_RESPONSE'],
  ])('maps %s to safe %s', async (message, expected) => {
    api.listTransactions.mockRejectedValueOnce(
      new ServiceUnavailableException(message),
    );
    const result = await service.check({} as PaymentSettingsDraftDto, 'actor');
    expect(
      result.checks.find((row) => row.code === 'SEPAY_API_ACCESS'),
    ).toMatchObject({ status: 'FAIL', message: expected });
    expect(
      result.checks.find((row) => row.code === 'ACCOUNT_MATCH')?.status,
    ).toBe('SKIPPED');
    expect(JSON.stringify(result)).not.toContain('private-token');
    expect(JSON.stringify(result)).not.toContain('private-key');
  });
  it('distinguishes timeout and never returns provider response text', async () => {
    api.listTransactions.mockRejectedValueOnce(
      new ServiceUnavailableException({
        code: 'PROVIDER_TIMEOUT',
        message: 'private provider response',
      }),
    );
    const result = await service.check({} as PaymentSettingsDraftDto, 'actor');
    expect(result.checks[1].message).toBe('PROVIDER_TIMEOUT');
    expect(JSON.stringify(result)).not.toContain('private provider response');
  });
  it('treats an empty API response as readable, not verified account or webhook', async () => {
    const result = await service.check({} as PaymentSettingsDraftDto, 'actor');
    expect(result.checks.map((row) => row.status)).toEqual([
      'PASS',
      'PASS',
      'UNVERIFIED',
      'UNVERIFIED',
    ]);
    expect(api.listTransactions).toHaveBeenCalledWith(
      'TEST',
      expect.objectContaining({ page: 1, perPage: 1 }),
      expect.objectContaining({ apiToken: snapshot.apiToken }),
    );
    settings.resolveDraft.mockResolvedValueOnce({
      ...snapshot,
      apiToken: 'different-token',
    });
    expect(
      (await service.check({} as PaymentSettingsDraftDto, 'actor'))
        .draftFingerprint,
    ).not.toBe(result.draftFingerprint);
  });
  it('rejects stale/invalid drafts and rate limit before any network request', async () => {
    settings.resolveDraft.mockRejectedValueOnce(
      new Error('SETTINGS_REVISION_CONFLICT'),
    );
    await expect(
      service.check({} as PaymentSettingsDraftDto, 'actor'),
    ).rejects.toThrow();
    expect(limiter.upsert).not.toHaveBeenCalled();
    limiter.upsert.mockResolvedValueOnce({ count: 6 });
    await expect(
      service.check({} as PaymentSettingsDraftDto, 'actor'),
    ).rejects.toMatchObject({ status: 429 });
    expect(api.listTransactions).not.toHaveBeenCalled();
  });
});
