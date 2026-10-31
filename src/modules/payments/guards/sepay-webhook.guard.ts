import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  type RawBodyRequest,
  UnauthorizedException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { PaymentsClock } from '../payments.clock';
import { PaymentsConfig } from '../payments.config';

@Injectable()
export class SePayWebhookGuard implements CanActivate {
  constructor(
    private readonly config: PaymentsConfig,
    private readonly clock: PaymentsClock,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    this.config.assertPaymentsEnabled();
    const request = context
      .switchToHttp()
      .getRequest<RawBodyRequest<Request>>();
    if (
      request.headers['content-type']?.split(';')[0].trim().toLowerCase() !==
      'application/json'
    ) {
      throw new UnsupportedMediaTypeException(
        'Use application/json for this webhook',
      );
    }
    if (
      request.path === '/webhooks/sepay/test' &&
      process.env.PAYMENTS_MODE !== 'simulation'
    )
      throw new UnauthorizedException('Local test route is disabled');
    if (this.config.getWebhookAuthMethod() === 'apikey') {
      const configured = this.config.getWebhookApiKey();
      const supplied =
        request.headers.authorization?.match(/^Apikey ([^\s]+)$/i)?.[1] ?? '';
      const actual = Buffer.from(supplied),
        expected = Buffer.from(configured);
      if (
        actual.length !== expected.length ||
        !timingSafeEqual(actual, expected)
      )
        throw new UnauthorizedException('Invalid webhook API key');
      return true;
    }
    const secret = this.config.getWebhookSecret();
    const timestamp = request.headers['x-sepay-timestamp'];
    const signature = request.headers['x-sepay-signature'];
    if (
      typeof timestamp !== 'string' ||
      !/^\d{1,12}$/.test(timestamp) ||
      typeof signature !== 'string' ||
      !/^sha256=[a-fA-F0-9]{64}$/.test(signature) ||
      !Buffer.isBuffer(request.rawBody)
    ) {
      throw new UnauthorizedException('Invalid webhook signature');
    }
    // Chặn request quá cũ hoặc quá xa trong tương lai; retry hợp lệ cần chữ ký mới.
    if (
      Math.abs(
        Math.floor(this.clock.now().getTime() / 1000) - Number(timestamp),
      ) > 300
    ) {
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
      throw new UnauthorizedException('Invalid webhook signature');
    }
    return true;
  }
}
