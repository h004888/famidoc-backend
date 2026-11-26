import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { SePayReconciliationConfig } from './sepay-reconciliation.config';
import type {
  PaymentEnvironment,
  SePayApiTransaction,
  SePayTransactionPage,
  SePayTransactionQuery,
} from './sepay-api.types';

type SePayListResponse = {
  status?: unknown;
  data?: unknown;
  meta?: { pagination?: Record<string, unknown> };
};

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function formatVietnamDate(date: Date) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

function isTransaction(value: unknown): value is SePayApiTransaction {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === 'string' &&
    typeof item.transaction_date === 'string' &&
    typeof item.account_number === 'string' &&
    Number.isSafeInteger(item.amount_in) &&
    Number.isSafeInteger(item.amount_out) &&
    typeof item.transaction_content === 'string' &&
    (item.reference_number === null ||
      item.reference_number === undefined ||
      typeof item.reference_number === 'string') &&
    (item.code === null ||
      item.code === undefined ||
      typeof item.code === 'string') &&
    typeof item.bank_brand_name === 'string' &&
    typeof item.bank_account_id === 'string' &&
    ['in', 'out'].includes(String(item.transfer_type))
  );
}

@Injectable()
export class SePayApiClient {
  constructor(private readonly config: SePayReconciliationConfig) {}

  async listTransactions(
    environment: PaymentEnvironment,
    query: SePayTransactionQuery,
    credentials?: { apiToken: string; deadline?: number },
  ): Promise<SePayTransactionPage> {
    const url = new URL(`${this.config.getBaseUrl(environment)}/transactions`);
    url.searchParams.set('bank_account_id', query.bankAccountId);
    url.searchParams.set('page', String(query.page));
    url.searchParams.set('per_page', String(query.perPage));
    url.searchParams.set('transaction_date_sort', 'asc');
    url.searchParams.set('timestamp_format', 'iso8601');
    if (query.sinceId) url.searchParams.set('since_id', query.sinceId);
    if (query.from) {
      // Làm tròn xuống đầu phút để không bỏ sót giao dịch ngân hàng bị cắt giây về :00 (như MBBank).
      const flooredFrom = new Date(
        Math.floor(query.from.getTime() / 60_000) * 60_000,
      );
      url.searchParams.set(
        'transaction_date_from',
        formatVietnamDate(flooredFrom),
      );
    }
    if (query.to)
      url.searchParams.set('transaction_date_to', formatVietnamDate(query.to));

      let lastStatus: number | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      let response: Response;
      try {
        response = await fetch(url, {
          headers: {
            Accept: 'application/json',
              Authorization: `Bearer ${credentials?.apiToken ?? this.config.getToken(environment)}`,
          },
            signal: AbortSignal.timeout(Math.max(1, Math.min(10_000, (credentials?.deadline ?? (Date.now() + 10_000)) - Date.now()))),
        });
        } catch (error) {
        if (attempt < 2) {
          await wait(250 * 2 ** attempt);
          continue;
        }
          throw new ServiceUnavailableException({ message: 'Cannot reach SePay API', code: error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name) ? 'PROVIDER_TIMEOUT' : 'PROVIDER_UNAVAILABLE' });
      }
      lastStatus = response.status;
      if (response.status === 429 || response.status >= 500) {
        if (attempt < 2) {
          const seconds = Number(
            response.headers.get('x-sepay-userapi-retry-after') ??
              response.headers.get('retry-after') ??
              '1',
          );
          await wait(
            Number.isFinite(seconds)
                ? Math.min(Math.max(seconds, 0.25), 1) * 1000
              : 1000,
          );
          continue;
        }
      }
      if (!response.ok)
        throw new ServiceUnavailableException(
          `SePay API returned HTTP ${response.status}`,
        );

      let body: SePayListResponse;
      try {
        body = (await response.json()) as SePayListResponse;
      } catch {
        throw new ServiceUnavailableException(
          'SePay API returned invalid JSON',
        );
      }
      if (body.status !== 'success' || !Array.isArray(body.data))
        throw new ServiceUnavailableException(
          'SePay API response is malformed',
        );
      if (!body.data.every(isTransaction))
        throw new ServiceUnavailableException(
          'SePay API returned an unsupported transaction payload',
        );
      const pagination = body.meta?.pagination;
      if (!pagination || typeof pagination.has_more !== 'boolean')
        throw new ServiceUnavailableException(
          'SePay pagination metadata is missing',
        );
      return {
        transactions: body.data,
        currentPage:
          typeof pagination.current_page === 'number'
            ? pagination.current_page
            : query.page,
        hasMore: pagination.has_more,
      };
    }
    throw new ServiceUnavailableException(
      `SePay API is unavailable${lastStatus ? ` (HTTP ${lastStatus})` : ''}`,
    );
  }
}
