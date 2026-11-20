import { Module } from '@nestjs/common';
import { AuthAccessModule } from '../../core/auth/auth-access.module';
import { StorageModule } from '../../core/services/storage.module';
import { FinanceController } from './controllers/finance.controller';
import { FinanceServiceImpl } from './services/impl/finance.service.impl';
import { FINANCE_SERVICE_TOKEN } from './services/interfaces/finance.service.interface';
import { FinanceRepositoryImpl } from './repositories/impl/finance.repository.impl';
import { FINANCE_REPOSITORY_TOKEN } from './repositories/interfaces/finance.repository.interface';
import { PaymentsModule } from '../payments/payments.module';
import { SePayReconciliationService } from './services/sepay-reconciliation.service';
import { SePayReconciliationScheduler } from './services/sepay-reconciliation.scheduler';
@Module({
  imports: [AuthAccessModule, StorageModule, PaymentsModule],
  controllers: [FinanceController],
  providers: [
    { provide: FINANCE_SERVICE_TOKEN, useClass: FinanceServiceImpl },
    { provide: FINANCE_REPOSITORY_TOKEN, useClass: FinanceRepositoryImpl },
    SePayReconciliationService,
    SePayReconciliationScheduler,
  ],
})
export class FinanceModule {}
