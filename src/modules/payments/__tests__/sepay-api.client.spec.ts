import { ServiceUnavailableException } from '@nestjs/common';
import { SePayApiClient } from '../sepay/sepay-api.client';
import { SePayReconciliationConfig } from '../sepay/sepay-reconciliation.config';

describe('SePayApiClient', () => {
  const originalFetch = global.fetch;
  const originalToken = process.env.SEPAY_API_TOKEN_TEST;

  beforeEach(() => {
    process.env.SEPAY_API_TOKEN_TEST = 'sandbox-secret-token';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.SEPAY_API_TOKEN_TEST;
    else process.env.SEPAY_API_TOKEN_TEST = originalToken;
  });

  it('calls the sandbox v2 endpoint with Bearer auth and parses pagination', async () => {
    const transaction = {
      id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      transaction_date: '2026-11-13T08:00:00+07:00',
      account_number: '0123456789',
      amount_in: 100000,
      amount_out: 0,
      accumulated: 100000,
      transaction_content: 'FD000001',
      reference_number: 'FT-001',
      code: 'FD000001',
      bank_brand_name: 'MBBank',
      bank_account_id: 'b1b2c3d4-e5f6-7890-abcd-ef1234567890',
      va_id: null,
      webhook_success: 1,
      transfer_type: 'in',
    };
    global.fetch = jest.fn(async (input, init) => {
      const rawUrl =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const url = new URL(rawUrl);
      expect(url.origin).toBe('https://userapi-sandbox.sepay.vn');
      expect(url.searchParams.get('per_page')).toBe('100');
      expect(url.searchParams.get('timestamp_format')).toBe('iso8601');
      expect(new Headers(init?.headers).get('authorization')).toBe(
        'Bearer sandbox-secret-token',
      );
      return new Response(
        JSON.stringify({
          status: 'success',
          meta: { pagination: { has_more: false } },
          data: [transaction],
          meta: { pagination: { current_page: 1, has_more: false } },
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    const client = new SePayApiClient(new SePayReconciliationConfig());
    const result = await client.listTransactions('TEST', {
      bankAccountId: transaction.bank_account_id,
      page: 1,
      perPage: 100,
    });
    expect(result.transactions).toEqual([transaction]);
    expect(result.hasMore).toBe(false);
  });

  it('fails closed when SePay returns an unauthorized response', async () => {
    global.fetch = jest.fn(
      async () => new Response('{}', { status: 401 }),
    ) as typeof fetch;
    const client = new SePayApiClient(new SePayReconciliationConfig());
    await expect(
      client.listTransactions('TEST', {
        bankAccountId: 'b1b2c3d4-e5f6-7890-abcd-ef1234567890',
        page: 1,
        perPage: 100,
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('accepts transactions with null or empty reference_number', async () => {
    global.fetch = (async () =>
      new Response(
        JSON.stringify({
          status: 'success',
          meta: { pagination: { has_more: false } },
          data: [
            {
              id: 'tx-null-ref',
              transaction_date: '2026-11-18 10:00:00',
              account_number: '0000123456789',
              amount_in: 150000,
              amount_out: 0,
              transaction_content: 'FD8K4P9W2M TT FAMIDOC TEST',
              reference_number: null,
              code: null,
              bank_brand_name: 'MBBank',
              bank_account_id: 'acc-uuid-1',
              transfer_type: 'in',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as typeof fetch;
    const client = new SePayApiClient(new SePayReconciliationConfig());
    const page = await client.listTransactions('TEST' as never, {
      bankAccountId: 'acc-uuid-1',
      page: 1,
      perPage: 50,
    });
    expect(page.transactions).toHaveLength(1);
    expect(page.transactions[0].id).toBe('tx-null-ref');
  });
});
