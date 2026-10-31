import {
  Injectable,
  ServiceUnavailableException,
  ConflictException,
} from '@nestjs/common';
export interface PaymentDestination {
  accountNumber: string;
  gateway: string;
  ttlMinutes: number;
}
@Injectable()
export class PaymentsConfig {
  assertSimulationEnabled() {
    if (
      process.env.NODE_ENV !== 'development' ||
      process.env.PAYMENTS_MODE !== 'simulation'
    )
      throw new ServiceUnavailableException(
        'Demo helper functions are only available in local simulation',
      );
  }
  assertPaymentsEnabled() {
    const mode = process.env.PAYMENTS_MODE;
    if (!['simulation', 'sepay_test', 'live'].includes(mode ?? ''))
      throw new ServiceUnavailableException(
        'Configure PAYMENTS_MODE before accepting payments',
      );
    if (mode === 'simulation' && process.env.NODE_ENV !== 'development')
      throw new ServiceUnavailableException(
        'Local simulation is disabled outside development',
      );
  }
  getEnvironment(): 'TEST' | 'LIVE' {
    this.assertPaymentsEnabled();
    return process.env.PAYMENTS_MODE === 'live' ? 'LIVE' : 'TEST';
  }
  assertContractEnvironment(isDemo: boolean) {
    if ((this.getEnvironment() === 'TEST') !== isDemo)
      throw new ConflictException(
        'Demo contracts and live contracts must use separate payment environments',
      );
  }
  getDestination(): PaymentDestination {
    this.assertPaymentsEnabled();
    const accountNumber = process.env.PAYMENTS_EXPECTED_ACCOUNT?.trim();
    const gateway = process.env.PAYMENTS_EXPECTED_GATEWAY?.trim();
    const ttl = process.env.PAYMENT_REQUEST_TTL_MINUTES ?? '15';
    if (
      !accountNumber ||
      !/^\d{5,19}$/.test(accountNumber) ||
      !gateway ||
      gateway.length > 100 ||
      !/^\d+$/.test(ttl) ||
      Number(ttl) < 1 ||
      Number(ttl) > 1440
    )
      throw new ServiceUnavailableException(
        'Configure the bank account, bank code and payment TTL',
      );
    if (process.env.PAYMENTS_MODE !== 'simulation' && Number(ttl) !== 15)
      throw new ServiceUnavailableException(
        'Contract invoices must expire after 15 minutes',
      );
    if (
      process.env.PAYMENTS_MODE === 'live' &&
      (/^0+$/.test(accountNumber) || /test/i.test(gateway))
    )
      throw new ServiceUnavailableException(
        'Replace the placeholder bank settings before enabling live payments',
      );
    return { accountNumber, gateway, ttlMinutes: Number(ttl) };
  }
  getWebhookSecret() {
    this.assertPaymentsEnabled();
    const secret = process.env.SEPAY_WEBHOOK_SECRET;
    if (!secret || secret.length < 32)
      throw new ServiceUnavailableException(
        'Configure SEPAY_WEBHOOK_SECRET with at least 32 characters',
      );
    return secret;
  }
  getWebhookApiKey() {
    this.assertPaymentsEnabled();
    const key = process.env.SEPAY_WEBHOOK_API_KEY;
    if (!key || key.length < 32)
      throw new ServiceUnavailableException(
        'Configure SEPAY_WEBHOOK_API_KEY with at least 32 characters',
      );
    return key;
  }
  getWebhookAuthMethod() {
    const method = process.env.SEPAY_WEBHOOK_AUTH ?? 'hmac';
    if (!['hmac', 'apikey'].includes(method))
      throw new ServiceUnavailableException(
        'Use hmac or apikey webhook authentication',
      );
    return method;
  }
}
