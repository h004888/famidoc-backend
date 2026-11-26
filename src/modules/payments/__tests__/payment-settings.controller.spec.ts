import { PaymentSettingsService } from '../settings/payment-settings.service';
import type {
  PaymentSettingsDraftDto,
  PaymentSettingsSnapshot,
} from '../settings/payment-settings.dto';
import { PaymentsConfig } from '../payments.config';
import { SePayReconciliationConfig } from '../sepay/sepay-reconciliation.config';
import { PaymentSettingsRepository } from '../settings/payment-settings.repository';

export const validDraft: PaymentSettingsDraftDto = {
  environment: 'TEST',
  expectedRevision: 1,
  accountNumber: '00123456789',
  gateway: ' MBBank ',
  bankAccountId: '11111111-1111-4111-8111-111111111111',
  authMethod: 'hmac',
  apiToken: '',
  webhookSecret: '',
};
export const storedSnapshot: PaymentSettingsSnapshot = {
  ...validDraft,
  revision: 1,
  revisionId: '22222222-2222-4222-8222-222222222222',
  monitoredAccountId: '33333333-3333-4333-8333-333333333333',
  ttlMinutes: 15,
  apiToken: 'saved-token',
  webhookSecret: 's'.repeat(32),
};
describe('Payment settings draft contract', () => {
  const repository = { current: jest.fn().mockResolvedValue(storedSnapshot) };
  const service = new PaymentSettingsService(
    repository as unknown as PaymentSettingsRepository,
    new PaymentsConfig(),
    new SePayReconciliationConfig(),
  );
  it('preserves leading zeros and saved secrets while normalizing gateway', async () => {
    const snapshot = await service.resolveDraft(validDraft);
    expect(snapshot.accountNumber).toBe('00123456789');
    expect(snapshot.gateway).toBe('MBBank');
    expect(snapshot.apiToken).toBe('saved-token');
    expect(snapshot.webhookSecret).toBe('s'.repeat(32));
  });
  it.each([
    { accountNumber: '1234' },
    { accountNumber: '1'.repeat(20) },
    { bankAccountId: 'bad' },
    { webhookSecret: 'short' },
    { gateway: '   ' },
    { expectedRevision: 0 },
  ])('rejects invalid/stale drafts %o', async (changes) => {
    await expect(
      service.resolveDraft({ ...validDraft, ...changes }),
    ).rejects.toThrow();
  });
  it('rejects LIVE placeholders and missing initial secrets', async () => {
    await expect(
      service.resolveDraft({
        ...validDraft,
        environment: 'LIVE',
        accountNumber: '00000',
      }),
    ).rejects.toThrow();
    repository.current.mockResolvedValueOnce(null);
    await expect(
      service.resolveDraft({ ...validDraft, expectedRevision: 0 }),
    ).rejects.toThrow();
  });
  it('propagates storage failure rather than falling back to environment', async () => {
    repository.current.mockRejectedValueOnce(new Error('unavailable'));
    await expect(service.resolveDraft(validDraft)).rejects.toThrow();
  });
});
