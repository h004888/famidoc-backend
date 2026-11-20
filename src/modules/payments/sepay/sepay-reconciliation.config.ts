import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { PaymentEnvironment } from './sepay-api.types';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class SePayReconciliationConfig {
  isEnabled() {
    return process.env.SEPAY_RECONCILIATION_ENABLED === 'true';
  }

  getBaseUrl(environment: PaymentEnvironment) {
    return environment === 'LIVE'
      ? 'https://userapi.sepay.vn/v2'
      : 'https://userapi-sandbox.sepay.vn/v2';
  }

  getToken(environment: PaymentEnvironment) {
    const token = process.env[`SEPAY_API_TOKEN_${environment}`]?.trim();
    if (!token)
      throw new ServiceUnavailableException(
        `Configure SEPAY_API_TOKEN_${environment} before running reconciliation`,
      );
    return token;
  }

  getBankAccountId(environment: PaymentEnvironment) {
    const id = process.env[`SEPAY_BANK_ACCOUNT_ID_${environment}`]?.trim();
    if (!id || !UUID.test(id))
      throw new ServiceUnavailableException(
        `Configure SEPAY_BANK_ACCOUNT_ID_${environment} with the SePay account UUID`,
      );
    return id;
  }

  getIntervalMilliseconds() {
    const value = process.env.SEPAY_RECONCILIATION_INTERVAL_MINUTES ?? '15';
    if (!/^\d+$/.test(value) || Number(value) < 5 || Number(value) > 1440)
      throw new ServiceUnavailableException(
        'SEPAY_RECONCILIATION_INTERVAL_MINUTES must be between 5 and 1440',
      );
    return Number(value) * 60_000;
  }

  getLookbackMilliseconds() {
    const value = process.env.SEPAY_RECONCILIATION_LOOKBACK_HOURS ?? '24';
    if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 720)
      throw new ServiceUnavailableException(
        'SEPAY_RECONCILIATION_LOOKBACK_HOURS must be between 1 and 720',
      );
    return Number(value) * 3_600_000;
  }
}
