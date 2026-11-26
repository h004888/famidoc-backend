import { PAYMENTS_SERVICE_TOKEN } from './services/interfaces/payments.service.interface';
import { AuthAccessModule } from '../../core/auth/auth-access.module';
import { PaymentSettingsCrypto } from './settings/payment-settings.crypto';
import { PaymentSettingsRepository } from './settings/payment-settings.repository';
import { PaymentSettingsService } from './settings/payment-settings.service';
import { PaymentSettingsBootstrapService } from './settings/payment-settings-bootstrap.service';
import { PaymentSettingsCheckService } from './settings/payment-settings-check.service';
import { PaymentConfigurationTestService } from './settings/payment-configuration-test.service';
import { PaymentSettingsController } from './settings/payment-settings.controller';
import { EncountersModule } from '../encounters/encounters.module';
import { Module } from '@nestjs/common';
import { SePayWebhookGuard } from './guards/sepay-webhook.guard';
import { PaymentsClock } from './payments.clock';
import { PaymentsConfig } from './payments.config';
import { PaymentsController } from './controllers/payments.controller';
import { PaymentsServiceImpl } from './services/impl/payments.service.impl';
import { PaymentsRepositoryImpl } from './repositories/impl/payments.repository.impl';
import { PAYMENTS_REPOSITORY_TOKEN } from './repositories/interfaces/payments.repository.interface';
import { SePayWebhookController } from './controllers/sepay-webhook.controller';
import { SePayApiClient } from './sepay/sepay-api.client';
import { SePayReconciliationConfig } from './sepay/sepay-reconciliation.config';
import { SePayWebhookEvents, SePayWebhookExceptionFilter } from './sepay/sepay-webhook-events';

@Module({
  imports: [AuthAccessModule, EncountersModule],
  controllers: [PaymentSettingsController, PaymentsController, SePayWebhookController],
  providers: [
    PaymentSettingsCrypto, PaymentSettingsRepository, PaymentSettingsService, PaymentSettingsBootstrapService,
    PaymentSettingsCheckService, PaymentConfigurationTestService,
    PaymentsServiceImpl,
    { provide: PAYMENTS_SERVICE_TOKEN, useExisting: PaymentsServiceImpl },
    PaymentsClock,
    PaymentsConfig,
    SePayWebhookGuard,
    SePayWebhookEvents,
    SePayWebhookExceptionFilter,
    SePayApiClient,
    SePayReconciliationConfig,
    // Dùng Invoice và MedicalContract của schema chung; dữ liệu không mất khi restart.
    { provide: PAYMENTS_REPOSITORY_TOKEN, useClass: PaymentsRepositoryImpl },
  ],
  exports: [
    PaymentSettingsService, PaymentSettingsRepository, PaymentConfigurationTestService,
    PaymentsServiceImpl,
    PAYMENTS_SERVICE_TOKEN,
    PaymentsConfig,
    SePayApiClient,
    SePayReconciliationConfig,
  ],
})
export class PaymentsModule {}
