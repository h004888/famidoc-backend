import { Module } from '@nestjs/common';
import { AuthAccessModule } from '../../core/auth/auth-access.module';
import { ContractsController } from './controllers/contracts.controller';
import { DocumensoWebhookController } from './controllers/documenso-webhook.controller';
import { ContractsServiceImpl } from './services/impl/contracts.service.impl';
import { CONTRACTS_SERVICE_TOKEN } from './services/interfaces/contracts.service.interface';
import { ContractsRepositoryImpl } from './repositories/impl/contracts.repository.impl';
import { CONTRACTS_REPOSITORY_TOKEN } from './repositories/interfaces/contracts.repository.interface';
import { ContractDocumentRendererService } from './services/contract-document-renderer.service';
import { ContractPaymentNoticeService } from './services/contract-payment-notice.service';
import { ContractPdfRendererService } from './services/contract-pdf-renderer.service';
import { DocumensoClientService } from './services/documenso-client.service';
import { DocumensoSyncService } from './services/documenso-sync.service';
import { ContractHoldCleanupService } from './services/contract-hold-cleanup.service';
import { SigningDeadlineWorker } from './services/signing-deadline-worker.service';

@Module({
  imports: [AuthAccessModule],
  controllers: [ContractsController, DocumensoWebhookController],
  providers: [
    { provide: CONTRACTS_SERVICE_TOKEN, useClass: ContractsServiceImpl },
    { provide: CONTRACTS_REPOSITORY_TOKEN, useClass: ContractsRepositoryImpl },
    ContractDocumentRendererService,
    ContractPaymentNoticeService,
    ContractPdfRendererService,
    DocumensoClientService,
    DocumensoSyncService,
    ContractHoldCleanupService,
    SigningDeadlineWorker,
  ],
  exports: [
    ContractDocumentRendererService,
    ContractPdfRendererService,
    ContractHoldCleanupService,
  ],
})
export class ContractsModule {}
