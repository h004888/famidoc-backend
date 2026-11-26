import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PaymentsConfig } from '../payments.config';
import { SePayReconciliationConfig } from '../sepay/sepay-reconciliation.config';
import { PaymentSettingsRepository } from './payment-settings.repository';
import type {
  PaymentSettingsDraftDto,
  PaymentSettingsSnapshot,
} from './payment-settings.dto';
import { PrismaService } from '../../../core/database/prisma.service';

@Injectable()
export class PaymentSettingsService {
  constructor(
    readonly repository: PaymentSettingsRepository,
    readonly config: PaymentsConfig,
    readonly sepay: SePayReconciliationConfig,
  ) {}
  environmentSnapshot(
    environment: 'TEST' | 'LIVE',
  ): PaymentSettingsSnapshot | null {
    try {
      const destination = this.config.getDestination();
      const authMethod = this.config.getWebhookAuthMethod() as
        'hmac' | 'apikey';
      return {
        environment,
        revision: 0,
        revisionId: null,
        monitoredAccountId: null,
        ...destination,
        bankAccountId: this.sepay.getBankAccountId(environment),
        apiToken: this.sepay.getToken(environment),
        authMethod,
        ...(authMethod === 'hmac'
          ? { webhookSecret: this.config.getWebhookSecret() }
          : { webhookApiKey: this.config.getWebhookApiKey() }),
      };
    } catch {
      return null;
    }
  }
  async resolveSnapshot(environment: 'TEST' | 'LIVE') {
    const snapshot = await this.repository.current(environment);
    if (snapshot) return snapshot;
    const legacy = this.environmentSnapshot(environment);
    if (!legacy)
      throw new ServiceUnavailableException('PAYMENT_SETTINGS_UNCONFIGURED');
    return legacy;
  }
  async resolveDraft(
    dto: PaymentSettingsDraftDto,
  ): Promise<PaymentSettingsSnapshot> {
    if (!['TEST', 'LIVE'].includes(dto.environment))
      throw new UnprocessableEntityException('INVALID_ENVIRONMENT');
    const current =
      (await this.repository.current(dto.environment)) ??
      this.environmentSnapshot(dto.environment);
    if (
      !Number.isInteger(dto.expectedRevision) ||
      dto.expectedRevision !== (current?.revision ?? 0)
    )
      throw new ConflictException('SETTINGS_REVISION_CONFLICT');
    const accountNumber = dto.accountNumber?.trim(),
      gateway = dto.gateway?.trim(),
      bankAccountId = dto.bankAccountId?.trim().toLowerCase();
    if (
      !/^\d{5,19}$/.test(accountNumber ?? '') ||
      !gateway ||
      gateway.length > 100 ||
      !/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(
        bankAccountId ?? '',
      ) ||
      !['hmac', 'apikey'].includes(dto.authMethod) ||
      (dto.environment === 'LIVE' &&
        (/^0+$/.test(accountNumber) || /test/i.test(gateway)))
    )
      throw new UnprocessableEntityException('INVALID_PAYMENT_SETTINGS');
    const apiToken = dto.apiToken?.trim() || current?.apiToken;
    const webhookSecret = dto.webhookSecret?.trim() || current?.webhookSecret;
    const webhookApiKey = dto.webhookApiKey?.trim() || current?.webhookApiKey;
    const selected = dto.authMethod === 'hmac' ? webhookSecret : webhookApiKey;
    if (
      !apiToken ||
      apiToken.length > 4096 ||
      !selected ||
      selected.length < 32 ||
      selected.length > 4096 ||
      [dto.webhookSecret, dto.webhookApiKey].some(
        (value) =>
          value?.trim() &&
          (value.trim().length < 32 || value.trim().length > 4096),
      )
    )
      throw new UnprocessableEntityException(
        'PAYMENT_SETTINGS_SECRET_REQUIRED',
      );
    return {
      environment: dto.environment,
      revision: current?.revision ?? 0,
      revisionId: current?.revisionId ?? null,
      monitoredAccountId: current?.monitoredAccountId ?? null,
      accountNumber,
      gateway,
      bankAccountId,
      authMethod: dto.authMethod,
      apiToken,
      webhookSecret,
      webhookApiKey,
      ttlMinutes: 15,
    };
  }
  publicSettings(
    snapshot: PaymentSettingsSnapshot | null,
    environment: 'TEST' | 'LIVE',
  ) {
    return {
      environment,
      activeEnvironment: this.config.getEnvironment(),
      revision: snapshot?.revision ?? 0,
      persisted: Boolean(snapshot?.revisionId),
      accountNumber: snapshot?.accountNumber ?? '',
      gateway: snapshot?.gateway ?? '',
      bankAccountId: snapshot?.bankAccountId ?? '',
      authMethod: snapshot?.authMethod ?? 'hmac',
      ttlMinutes: 15,
      hasApiToken: Boolean(snapshot?.apiToken),
      hasWebhookSecret: Boolean(snapshot?.webhookSecret),
      hasWebhookApiKey: Boolean(snapshot?.webhookApiKey),
      webhookUrl: '/api/v1/payments/webhook/vietqr',
      simulation: process.env.PAYMENTS_MODE === 'simulation',
    };
  }
  async get(environment: 'TEST' | 'LIVE') {
    return this.publicSettings(
      (await this.repository.current(environment)) ??
        this.environmentSnapshot(environment),
      environment,
    );
  }
  async save(
    dto: PaymentSettingsDraftDto,
    actorId: string,
    prisma: PrismaService,
  ) {
    const snapshot = await this.resolveDraft(dto);
    const legacy = this.environmentSnapshot(dto.environment);
    if (!(await this.repository.current(dto.environment)))
      await this.assertLegacyMapping(prisma, dto.environment, legacy);
    return this.publicSettings(
      await this.repository.save(
        snapshot,
        dto.expectedRevision,
        actorId,
        legacy,
      ),
      dto.environment,
    );
  }
  async assertLegacyMapping(
    prisma: PrismaService,
    environment: string,
    legacy: PaymentSettingsSnapshot | null,
  ) {
    const historical = await prisma.invoice.findMany({
      where: { environment, paymentStatus: 'PENDING' },
      distinct: ['expectedAccountNumber', 'expectedGateway'],
      select: { expectedAccountNumber: true, expectedGateway: true },
    });
    if (
      historical.some(
        (row) =>
          row.expectedAccountNumber &&
          (!legacy ||
            row.expectedAccountNumber !== legacy.accountNumber ||
            row.expectedGateway?.trim().toLowerCase() !==
              legacy.gateway.trim().toLowerCase()),
      )
    )
      throw new ConflictException('LEGACY_ACCOUNT_UNCONFIGURED');
  }
}
