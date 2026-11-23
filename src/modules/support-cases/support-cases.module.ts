import { Module } from '@nestjs/common';
import { AuthAccessModule } from '../../core/auth/auth-access.module';
import { StorageModule } from '../../core/services/storage.module';
import { SupportCasesController } from './controllers/support-cases.controller';
import { SupportCasesService } from './services/support-cases.service';

@Module({
  imports: [AuthAccessModule, StorageModule],
  controllers: [SupportCasesController],
  providers: [SupportCasesService],
  exports: [SupportCasesService],
})
export class SupportCasesModule {}
