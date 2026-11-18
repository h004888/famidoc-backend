import {
  buildTransferContent,
  createPaymentCode,
  extractPaymentCodes,
} from '../sepay/sepay-transaction.helpers';
import type { SePayWebhookDto } from '../dtos/sepay-webhook.dto';

describe('Named transfer descriptions and six-digit payment codes', () => {
  it('generates non-sequential 8-char safe alphanumeric FD codes with at least one digit', () => {
    const generated = new Set<string>();
    for (let i = 0; i < 50; i += 1) {
      const code = createPaymentCode();
      expect(code).toMatch(/^FD(?=[2-9A-HJ-NP-Z]*[2-9])[2-9A-HJ-NP-Z]{8}$/);
      expect(code).not.toMatch(/[0O1I]/);
      generated.add(code);
    }
    expect(generated.size).toBe(50);
  });
  it('extracts new 8-char FD codes as well as legacy 6-digit and 24/32-hex codes', () => {
    expect(
      extractPaymentCodes({
        content: 'FD8K4P9W2M TT FAMIDOC NGUYEN HOAI NAM',
        code: 'FD8K4P9W2M',
      } as SePayWebhookDto),
    ).toEqual(['FD8K4P9W2M']);
    expect(
      extractPaymentCodes({
        content: 'NGUYEN HOAI NAM - FD123456',
        code: 'FD123456',
      } as SePayWebhookDto),
    ).toEqual(['FD123456']);
    expect(
      extractPaymentCodes({
        content: 'FDABCDEFGH TT FAMIDOC TEST',
        code: null,
      } as SePayWebhookDto),
    ).toEqual([]);
  });
  it('uses the account display name without Vietnamese accents', () => {
    expect(buildTransferContent('Nguyễn Hoài Nam', 'FD8K4P9W2M')).toBe(
      'FD8K4P9W2M TT FAMIDOC NGUYEN HOAI NAM',
    );
    expect(buildTransferContent('Đặng Đình Đức', 'FD8K4P9W2M')).toBe(
      'FD8K4P9W2M TT FAMIDOC DANG DINH DUC',
    );
    expect(buildTransferContent(undefined, 'FD8K4P9W2M')).toBe(
      'FD8K4P9W2M TT FAMIDOC',
    );
  });
  it('does not let a display name that looks like a payment code identify another invoice', () => {
    const content = buildTransferContent('Nam FD000002', 'FD8K4P9W2M');
    const payload = { content, code: 'FD8K4P9W2M' } as SePayWebhookDto;
    expect(extractPaymentCodes(payload)).toEqual(['FD8K4P9W2M']);
  });
  it('keeps the whole payment code at the start when the display name is long', () => {
    const content = buildTransferContent('Tên dài '.repeat(30), 'FD8K4P9W2M');
    expect(content.length).toBeLessThanOrEqual(50);
    expect(content.startsWith('FD8K4P9W2M TT FAMIDOC ')).toBe(true);
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
