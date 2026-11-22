import { Module } from '@nestjs/common';
import { AuthAccessModule } from '../../core/auth/auth-access.module';
import { PrismaModule } from '../../core/database/prisma.module';
import { StorageModule } from '../../core/services/storage.module';
import { TelehealthController } from './controllers/telehealth.controller';
import { TelehealthWebhookController } from './controllers/telehealth-webhook.controller';
import { TELEHEALTH_REPOSITORY_TOKEN } from './repositories/interfaces/telehealth.repository.interface';
import { PrismaTelehealthRepository } from './repositories/prisma-telehealth.repository';
import { LivekitClientService } from './services/livekit-client.service';
import { TelehealthService } from './services/telehealth.service';

@Module({
  imports: [AuthAccessModule, PrismaModule, StorageModule],
  controllers: [TelehealthController, TelehealthWebhookController],
  providers: [
    LivekitClientService,
    TelehealthService,
    {
      provide: TELEHEALTH_REPOSITORY_TOKEN,
      useClass: PrismaTelehealthRepository,
    },
  ],
  exports: [TelehealthService],
})
export class TelehealthModule {}
