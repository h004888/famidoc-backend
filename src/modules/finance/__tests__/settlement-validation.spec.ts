import { ValidationPipe } from '@nestjs/common';
import { MonthlySettlementDto } from '../dtos/finance.dto';

const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
});
const metadata = { type: 'body' as const, metatype: MonthlySettlementDto };
const settlementId = '10000000-0000-4000-8000-000000000001';
const transfer = {
  action: 'CONFIRM_TRANSFER',
  settlementId,
  bankTransferOrderId: 'FT001',
  transferMemo: 'CHI TRA THANG 10',
  amountPaidVnd: 10000,
  paidAt: '2026-11-21T10:00:00Z',
  evidenceKey: `${settlementId}/settlements/proof.pdf`,
};

describe('Settlement transfer input validation', () => {
  it.each([undefined, null, '', '          ', 'abc', 'x'.repeat(1001)])(
    'rejects invalid failure reason %j',
    async (failureReason) => {
      await expect(
        pipe.transform(
          { action: 'MARK_FAILED', settlementId, failureReason },
          metadata,
        ),
      ).rejects.toMatchObject({ status: 400 });
    },
  );

  it.each([undefined, null, '', '   ', 'ab', 'x'.repeat(101)])(
    'rejects invalid bank order %j',
    async (bankTransferOrderId) => {
      await expect(
        pipe.transform({ ...transfer, bankTransferOrderId }, metadata),
      ).rejects.toMatchObject({ status: 400 });
    },
  );

  it.each([undefined, null, '', '   ', 'x'.repeat(141)])(
    'requires a nonblank transfer memo %j',
    async (transferMemo) => {
      await expect(
        pipe.transform({ ...transfer, transferMemo }, metadata),
      ).rejects.toMatchObject({ status: 400 });
    },
  );

  it.each([undefined, null, '', '     ', 'abcd', 'x'.repeat(301)])(
    'rejects invalid evidence key %j',
    async (evidenceKey) => {
      await expect(
        pipe.transform({ ...transfer, evidenceKey }, metadata),
      ).rejects.toMatchObject({ status: 400 });
    },
  );

  it('trims inputs before validating and returns the normalized values', async () => {
    await expect(
      pipe.transform(
        {
          ...transfer,
          bankTransferOrderId: '  FT001  ',
          transferMemo: '  CHI TRA  ',
          evidenceKey: `  ${settlementId}/settlements/proof.pdf  `,
        },
        metadata,
      ),
    ).resolves.toMatchObject({
      bankTransferOrderId: 'FT001',
      transferMemo: 'CHI TRA',
      evidenceKey: `${settlementId}/settlements/proof.pdf`,
    });
    await expect(
      pipe.transform(
        {
          action: 'MARK_FAILED',
          settlementId,
          failureReason: '  Sai tài khoản thụ hưởng  ',
        },
        metadata,
      ),
    ).resolves.toMatchObject({ failureReason: 'Sai tài khoản thụ hưởng' });
  });

  it('keeps memo required only for transfer confirmation', async () => {
    await expect(
      pipe.transform({ action: 'PREPARE', year: 2026, month: 10 }, metadata),
    ).resolves.toBeDefined();
    await expect(
      pipe.transform(
        {
          action: 'MARK_FAILED',
          settlementId,
          failureReason: 'Sai tài khoản thụ hưởng',
        },
        metadata,
      ),
    ).resolves.toBeDefined();
    await expect(
      pipe.transform(
        {
          action: 'MARK_FAILED',
          settlementId,
          failureReason: 'Sai tài khoản thụ hưởng',
          transferMemo: 'Unexpected',
        },
        metadata,
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
});
