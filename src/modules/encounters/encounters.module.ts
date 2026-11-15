import { Module } from '@nestjs/common';
import { AuthAccessModule } from '../../core/auth/auth-access.module';
import { PrismaModule } from '../../core/database/prisma.module';
import { EncountersController } from './controllers/encounters.controller';
import { EncountersServiceImpl } from './services/impl/encounters.service.impl';
import { ENCOUNTERS_SERVICE_TOKEN } from './services/interfaces/encounters.service.interface';
import { EncountersRepositoryImpl } from './repositories/impl/encounters.repository.impl';
import { ENCOUNTERS_REPOSITORY_TOKEN } from './repositories/interfaces/encounters.repository.interface';
import { EncounterRemindersService } from './services/impl/encounter-reminders.service';

@Module({
  imports: [AuthAccessModule, PrismaModule],
  controllers: [EncountersController],
  providers: [
    { provide: ENCOUNTERS_SERVICE_TOKEN, useClass: EncountersServiceImpl },
    { provide: ENCOUNTERS_REPOSITORY_TOKEN, useClass: EncountersRepositoryImpl },
    EncounterRemindersService,
  ],
  exports: [
    ENCOUNTERS_SERVICE_TOKEN,
    ENCOUNTERS_REPOSITORY_TOKEN,
    EncounterRemindersService,
  ],
})
export class EncountersModule {}
