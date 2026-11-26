import { PaymentSettingsCrypto } from '../settings/payment-settings.crypto';

describe('Payment settings encrypted persistence', () => {
  const oldKey = process.env.PAYMENT_SETTINGS_ENCRYPTION_KEY;
  beforeEach(() => {
    process.env.PAYMENT_SETTINGS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString(
      'base64',
    );
  });
  afterAll(() => {
    if (oldKey === undefined)
      delete process.env.PAYMENT_SETTINGS_ENCRYPTION_KEY;
    else process.env.PAYMENT_SETTINGS_ENCRYPTION_KEY = oldKey;
  });
  const crypto = new PaymentSettingsCrypto();
  it('round trips Unicode and randomizes each authenticated envelope', () => {
    const a = crypto.encrypt('bí mật 🔐');
    const b = crypto.encrypt('bí mật 🔐');
    expect(a).not.toEqual(b);
    expect(JSON.stringify(a)).not.toContain('bí mật');
    expect(crypto.decrypt(a)).toBe('bí mật 🔐');
    expect(crypto.decrypt(b)).toBe('bí mật 🔐');
  });
  it('rejects tampered ciphertext, tags and key identifiers', () => {
    const a = crypto.encrypt('private');
    for (const field of ['ciphertext', 'tag', 'keyId'] as const) {
      expect(() => crypto.decrypt({ ...a, [field]: 'invalid' })).toThrow();
    }
  });
  it('fails closed without a valid master key', () => {
    delete process.env.PAYMENT_SETTINGS_ENCRYPTION_KEY;
    expect(() => crypto.encrypt('private')).toThrow();
    process.env.PAYMENT_SETTINGS_ENCRYPTION_KEY = 'short';
    expect(() => crypto.encrypt('private')).toThrow();
  });
});
