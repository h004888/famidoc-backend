import { Module } from '@nestjs/common';
import { AuthAccessModule } from '../../core/auth/auth-access.module';
import { ContractsController } from './controllers/contracts.controller';
import { ContractsServiceImpl } from './services/impl/contracts.service.impl';
import { CONTRACTS_SERVICE_TOKEN } from './services/interfaces/contracts.service.interface';
import { ContractsRepositoryImpl } from './repositories/impl/contracts.repository.impl';
import { CONTRACTS_REPOSITORY_TOKEN } from './repositories/interfaces/contracts.repository.interface';
@Module({
  imports: [AuthAccessModule],
  controllers: [ContractsController],
  providers: [
    { provide: CONTRACTS_SERVICE_TOKEN, useClass: ContractsServiceImpl },
    { provide: CONTRACTS_REPOSITORY_TOKEN, useClass: ContractsRepositoryImpl },
  ],
})
export class ContractsModule {}
