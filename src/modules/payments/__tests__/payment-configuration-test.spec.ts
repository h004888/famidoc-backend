import {
  classifyPaymentTest,
  paymentTestStatus,
} from '../settings/payment-configuration-test.service';
describe('Payment configuration test isolation and lifetime', () => {
  const created = new Date('2026-11-25T10:00:00Z');
  const expiresAt = new Date(created.getTime() + 900000),
    finalizeAt = new Date(expiresAt.getTime() + 86400000);
  it('moves to waiting at QR expiry and terminal expiry strictly after delivery deadline', () => {
    expect(
      paymentTestStatus({ status: 'PENDING', expiresAt, finalizeAt }, created),
    ).toBe('PENDING');
    expect(
      paymentTestStatus(
        { status: 'PENDING', expiresAt, finalizeAt },
        expiresAt,
      ),
    ).toBe('WAITING_WEBHOOK');
    expect(
      paymentTestStatus(
        { status: 'PENDING', expiresAt, finalizeAt },
        finalizeAt,
      ),
    ).toBe('WAITING_WEBHOOK');
    expect(
      paymentTestStatus(
        { status: 'PENDING', expiresAt, finalizeAt },
        new Date(+finalizeAt + 1),
      ),
    ).toBe('EXPIRED');
    expect(
      paymentTestStatus(
        { status: 'SUCCEEDED', expiresAt, finalizeAt },
        new Date(+finalizeAt + 1),
      ),
    ).toBe('SUCCEEDED');
    expect(
      paymentTestStatus({ status: 'EXPIRED', expiresAt, finalizeAt }, created),
    ).toBe('EXPIRED');
  });
  it('classifies unknown, mixed and malformed PTC before business ingestion', () => {
    const code = 'PTC' + 'a'.repeat(24);
    expect(classifyPaymentTest('FDABC1234').isTest).toBe(false);
    expect(classifyPaymentTest(code)).toEqual({
      isTest: true,
      code: code.toUpperCase(),
      mixed: false,
    });
    expect(classifyPaymentTest(code + ' FDABC1234').mixed).toBe(true);
    expect(classifyPaymentTest('PTCinvalid')).toEqual({
      isTest: true,
      code: null,
      mixed: false,
    });
    expect(classifyPaymentTest(code + ' PTC' + 'b'.repeat(24)).mixed).toBe(
      true,
    );
  });
});
