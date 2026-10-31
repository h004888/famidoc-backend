import { PAYMENTS_SERVICE_TOKEN } from './services/interfaces/payments.service.interface';
import { AuthAccessModule } from '../../core/auth/auth-access.module';
import { Module } from '@nestjs/common';
import { SePayWebhookGuard } from './guards/sepay-webhook.guard';
import { PaymentsClock } from './payments.clock';
import { PaymentsConfig } from './payments.config';
import { PaymentsController } from './controllers/payments.controller';
import { PaymentsServiceImpl } from './services/impl/payments.service.impl';
import { PaymentsRepositoryImpl } from './repositories/impl/payments.repository.impl';
import { PAYMENTS_REPOSITORY_TOKEN } from './repositories/interfaces/payments.repository.interface';
import { SePayWebhookController } from './controllers/sepay-webhook.controller';

@Module({
  imports: [AuthAccessModule],
  controllers: [PaymentsController, SePayWebhookController],
  providers: [
    PaymentsServiceImpl,
    { provide: PAYMENTS_SERVICE_TOKEN, useExisting: PaymentsServiceImpl },
    PaymentsClock,
    PaymentsConfig,
    SePayWebhookGuard,
    // Dùng Invoice và MedicalContract của schema chung; dữ liệu không mất khi restart.
    { provide: PAYMENTS_REPOSITORY_TOKEN, useClass: PaymentsRepositoryImpl },
  ],
  exports: [PaymentsServiceImpl, PAYMENTS_SERVICE_TOKEN],
})
export class PaymentsModule {}
