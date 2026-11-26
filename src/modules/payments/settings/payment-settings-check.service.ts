import { HttpException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { PaymentsClock } from '../payments.clock';
import { SePayApiClient } from '../sepay/sepay-api.client';
import { PaymentSettingsCrypto } from './payment-settings.crypto';
import { PaymentSettingsDraftDto } from './payment-settings.dto';
import { PaymentSettingsService } from './payment-settings.service';

@Injectable()
export class PaymentSettingsCheckService {
  constructor(
    private readonly settings: PaymentSettingsService,
    private readonly prisma: PrismaService,
    private readonly api: SePayApiClient,
    private readonly crypto: PaymentSettingsCrypto,
    private readonly clock: PaymentsClock,
  ) {}
  async check(dto: PaymentSettingsDraftDto, actorId: string) {
    const snapshot = await this.settings.resolveDraft(dto);
    const now = this.clock.now(),
      windowStart = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
    await this.prisma.paymentConfigurationCheckWindow.deleteMany({
      where: { windowStart: { lt: new Date(now.getTime() - 86_400_000) } },
    });
    const window = await this.prisma.paymentConfigurationCheckWindow.upsert({
      where: { actorId_windowStart: { actorId, windowStart } },
      create: { actorId, windowStart, count: 1 },
      update: { count: { increment: 1 } },
    });
    if (window.count > 5)
      throw new HttpException('PAYMENT_SETTINGS_CHECK_RATE_LIMITED', 429);
    const draftFingerprint = this.crypto.fingerprint(
      JSON.stringify({
        environment: snapshot.environment,
        accountNumber: snapshot.accountNumber,
        gateway: snapshot.gateway,
        bankAccountId: snapshot.bankAccountId,
        authMethod: snapshot.authMethod,
        apiToken: snapshot.apiToken,
        webhookSecret: snapshot.webhookSecret,
        webhookApiKey: snapshot.webhookApiKey,
      }),
    );
    let apiCheck: { code: string; status: string; message: string };
    try {
      await this.api.listTransactions(
        snapshot.environment,
        { bankAccountId: snapshot.bankAccountId, page: 1, perPage: 1 },
        { apiToken: snapshot.apiToken, deadline: Date.now() + 35_000 },
      );
      apiCheck = {
        code: 'SEPAY_API_ACCESS',
        status: 'PASS',
        message: 'Đọc API SePay thành công.',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const response =
        error instanceof HttpException ? error.getResponse() : null;
      const timeout =
        typeof response === 'object' &&
        response &&
        'code' in response &&
        response.code === 'PROVIDER_TIMEOUT';
      const code = /HTTP (401|403)/.test(message)
        ? 'AUTH_REJECTED'
        : /HTTP 429/.test(message)
          ? 'RATE_LIMITED'
          : timeout
            ? 'PROVIDER_TIMEOUT'
            : /JSON|malformed|metadata|payload/.test(message)
              ? 'MALFORMED_RESPONSE'
              : 'PROVIDER_UNAVAILABLE';
      apiCheck = { code: 'SEPAY_API_ACCESS', status: 'FAIL', message: code };
    }
    return {
      draftFingerprint,
      checks: [
        { code: 'REQUIRED_FIELDS', status: 'PASS', message: 'Dữ liệu hợp lệ.' },
        apiCheck,
        {
          code: 'ACCOUNT_MATCH',
          status: apiCheck.status === 'PASS' ? 'UNVERIFIED' : 'SKIPPED',
          message: 'Chưa xác minh ID SePay khớp số tài khoản.',
        },
        {
          code: 'WEBHOOK_RECEIPT',
          status: 'UNVERIFIED',
          message: 'Cần test giao dịch để xác nhận nhận webhook.',
        },
      ],
    };
  }
}
