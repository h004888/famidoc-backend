import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  Optional,
  type RawBodyRequest,
  UnauthorizedException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { PaymentsClock } from '../payments.clock';
import { PaymentsConfig } from '../payments.config';
import { PaymentSettingsService } from '../settings/payment-settings.service';

export interface VerifiedPaymentContext { environment: 'TEST' | 'LIVE'; monitoredAccountIds: string[] }

@Injectable()
export class SePayWebhookGuard implements CanActivate {
  constructor(
    private readonly config: PaymentsConfig,
    private readonly clock: PaymentsClock,
    @Optional() private readonly settings?: PaymentSettingsService,
  ) {}

  canActivate(context: ExecutionContext): boolean | Promise<boolean> {
    return this.settings ? this.verifySnapshot(context) : this.verifyLegacy(context);
  }
  private async verifySnapshot(context: ExecutionContext) {
    this.config.assertPaymentsEnabled();
    const request = context.switchToHttp().getRequest<RawBodyRequest<Request> & { verifiedPaymentContext?: VerifiedPaymentContext }>();
    if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json')
      throw new UnsupportedMediaTypeException('Use application/json for this webhook');
    if (request.path === '/webhooks/sepay/test' && process.env.PAYMENTS_MODE !== 'simulation') throw new UnauthorizedException();
    if (!Buffer.isBuffer(request.rawBody) || request.rawBody.length > 100_000) throw new UnauthorizedException('Invalid webhook body');
    const environment = this.config.getEnvironment();
    const body = request.body as { accountNumber?: unknown; gateway?: unknown };
    if (typeof body.accountNumber !== 'string' || typeof body.gateway !== 'string' || body.gateway.length > 100 || body.accountNumber.length > 34)
      throw new UnauthorizedException('Invalid webhook account');
    const candidates = await this.settings!.repository.credentials(environment, body.gateway, body.accountNumber, this.clock.now());
    if (!candidates.length && !await this.settings!.repository.current(environment)) return this.verifyLegacy(context);
    const verified = candidates.filter(candidate => {
      if (candidate.authMethod === 'apikey') {
        const actual = Buffer.from(request.headers.authorization?.match(/^Apikey ([^\s]+)$/i)?.[1] ?? '');
        const expected = Buffer.from(candidate.webhookApiKey ?? '');
        return actual.length > 0 && actual.length === expected.length && timingSafeEqual(actual, expected);
      }
      const timestamp = request.headers['x-sepay-timestamp'], signature = request.headers['x-sepay-signature'];
      if (typeof timestamp !== 'string' || !/^\d{1,12}$/.test(timestamp) || typeof signature !== 'string' || !/^sha256=[a-f0-9]{64}$/i.test(signature) ||
          Math.abs(Math.floor(this.clock.now().getTime() / 1000) - Number(timestamp)) > 300) return false;
      const expected = createHmac('sha256', candidate.webhookSecret ?? '').update(timestamp).update('.').update(request.rawBody!).digest();
      return timingSafeEqual(Buffer.from(signature.slice(7), 'hex'), expected);
    });
    if (!verified.length) throw new UnauthorizedException('Invalid webhook credentials');
    request.verifiedPaymentContext = { environment, monitoredAccountIds: [...new Set(verified.map(row => row.monitoredAccountId!))] };
    return true;
  }
  private verifyLegacy(context: ExecutionContext): boolean {
    this.config.assertPaymentsEnabled();
    const request = context
      .switchToHttp()
      .getRequest<RawBodyRequest<Request>>();
    console.log('[DEBUG_CP01][WEBHOOK_GUARD_ENTRY]', {
      timestamp: new Date().toISOString(),
      path: request.path,
      contentType: request.headers['content-type'],
      authHeader: request.headers.authorization ? 'EXISTS' : 'NONE',
      signatureHeader: request.headers['x-sepay-signature'] ? 'EXISTS' : 'NONE',
    });
    if (
      request.headers['content-type']?.split(';')[0].trim().toLowerCase() !==
      'application/json'
    ) {
      console.log('[DEBUG_CP01][WEBHOOK_GUARD_REJECTED]', { reason: 'Unsupported content-type' });
      throw new UnsupportedMediaTypeException(
        'Use application/json for this webhook',
      );
    }
    if (
      request.path === '/webhooks/sepay/test' &&
      process.env.PAYMENTS_MODE !== 'simulation'
    ) {
      console.log('[DEBUG_CP01][WEBHOOK_GUARD_REJECTED]', { reason: 'Local test route disabled' });
      throw new UnauthorizedException('Local test route is disabled');
    }
    if (this.config.getWebhookAuthMethod() === 'apikey') {
      const configured = this.config.getWebhookApiKey();
      const supplied =
        request.headers.authorization?.match(/^Apikey ([^\s]+)$/i)?.[1] ?? '';
      const actual = Buffer.from(supplied),
        expected = Buffer.from(configured);
      if (
        actual.length !== expected.length ||
        !timingSafeEqual(actual, expected)
      ) {
        console.log('[DEBUG_CP02][WEBHOOK_GUARD_AUTH_FAILED]', {
          method: 'apikey',
          reason: 'Invalid webhook API key',
        });
        throw new UnauthorizedException('Invalid webhook API key');
      }
      console.log('[DEBUG_CP02][WEBHOOK_GUARD_AUTH_PASSED]', { method: 'apikey' });
      return true;
    }
    const timestamp = request.headers['x-sepay-timestamp'];
    const signature = request.headers['x-sepay-signature'];
    // Bản tin id=0 chỉ xác nhận đường nhận webhook và không ghi giao dịch.
    const databaseUrl = process.env.DATABASE_URL ?? '';
    if (
      process.env.LOCAL_SEPAY_DEMO === '1' &&
      process.env.NODE_ENV === 'development' &&
      process.env.PAYMENTS_MODE === 'simulation' &&
      request.path === '/api/v1/payments/webhook/vietqr' &&
      request.body?.id === 0 &&
      timestamp === undefined &&
      signature === undefined &&
      ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(
        request.socket.remoteAddress ?? '',
      ) &&
      !request.headers.forwarded &&
      !request.headers['x-forwarded-for'] &&
      URL.canParse(databaseUrl)
    ) {
      const database = new URL(databaseUrl);
      if (
        database.host === '127.0.0.1:55432' &&
        database.pathname === '/famidoc_payment_local'
      ) {
        return true;
      }
    }
    const secret = this.config.getWebhookSecret();
    if (
      typeof timestamp !== 'string' ||
      !/^\d{1,12}$/.test(timestamp) ||
      typeof signature !== 'string' ||
      !/^sha256=[a-fA-F0-9]{64}$/.test(signature) ||
      !Buffer.isBuffer(request.rawBody)
    ) {
      console.log('[DEBUG_CP02][WEBHOOK_GUARD_AUTH_FAILED]', {
        method: 'signature',
        reason: 'Malformed signature or timestamp or rawBody',
      });
      throw new UnauthorizedException('Invalid webhook signature');
    }
    // Chặn request quá cũ hoặc quá xa trong tương lai; retry hợp lệ cần chữ ký mới.
    if (
      Math.abs(
        Math.floor(this.clock.now().getTime() / 1000) - Number(timestamp),
      ) > 300
    ) {
      console.log('[DEBUG_CP02][WEBHOOK_GUARD_AUTH_FAILED]', {
        method: 'signature',
        reason: 'Timestamp outside allowed window',
      });
      throw new UnauthorizedException(
        'Webhook timestamp is outside the allowed window',
      );
    }
    // SePay ký HMAC-SHA256 theo công thức đã đối chiếu tài liệu: timestamp + '.' + raw_body).
    // Không JSON.stringify(request.body) vì khoảng trắng/Unicode có thể khác byte gốc.
    const expected = createHmac('sha256', secret)
      .update(timestamp)
      .update('.')
      .update(request.rawBody)
      .digest();
    const actual = Buffer.from(signature.slice(7), 'hex');
    if (
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    ) {
      console.log('[DEBUG_CP02][WEBHOOK_GUARD_AUTH_FAILED]', {
        method: 'signature',
        reason: 'HMAC signature mismatch',
      });
      throw new UnauthorizedException('Invalid webhook signature');
    }
    console.log('[DEBUG_CP02][WEBHOOK_GUARD_AUTH_PASSED]', { method: 'signature' });
    return true;
  }
}
