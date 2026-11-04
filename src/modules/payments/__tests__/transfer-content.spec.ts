import {
  buildTransferContent,
  createPaymentCode,
  extractPaymentCodes,
} from '../sepay/sepay-transaction.helpers';
import type { SePayWebhookDto } from '../dtos/sepay-webhook.dto';

describe('Named transfer descriptions and six-digit payment codes', () => {
  it('pads allocated numbers and stops instead of reusing a code after six digits run out', () => {
    expect(createPaymentCode(1)).toBe('FD000001');
    expect(createPaymentCode(999999)).toBe('FD999999');
    expect(() => createPaymentCode(1000000)).toThrow(
      'Six-digit payment codes exhausted',
    );
    expect(() => createPaymentCode(0)).toThrow();
  });
  it('uses the account display name without Vietnamese accents', () => {
    expect(buildTransferContent('Nguyễn Hoài Nam', 'FD123456')).toBe(
      'NGUYEN HOAI NAM - FD123456',
    );
    expect(buildTransferContent('Đặng Đình Đức', 'FD123456')).toBe(
      'DANG DINH DUC - FD123456',
    );
  });
  it('does not let a display name that looks like a payment code identify another invoice', () => {
    const content = buildTransferContent('Nam FD000002', 'FD000001');
    const payload = { content, code: 'FD000001' } as SePayWebhookDto;
    expect(extractPaymentCodes(payload)).toEqual(['FD000001']);
  });
  it('keeps the whole payment code at the end when the display name is long', () => {
    const content = buildTransferContent('Tên dài '.repeat(30), 'FD123456');
    expect(content.length).toBeLessThanOrEqual(47);
    expect(content.endsWith(' - FD123456')).toBe(true);
  });
  it('reads an old code in full instead of treating its six-digit prefix as a new invoice', () => {
    const oldCode = 'FD123456' + 'A'.repeat(18);
    expect(
      extractPaymentCodes({
        content: 'NAM - ' + oldCode,
        code: 'FD123456',
      } as SePayWebhookDto),
    ).toEqual([oldCode]);
  });
});
