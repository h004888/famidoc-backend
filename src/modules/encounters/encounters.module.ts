import { Module } from '@nestjs/common';
import { AuthAccessModule } from '../../core/auth/auth-access.module';
import { PrismaModule } from '../../core/database/prisma.module';
import { StorageModule } from '../../core/services/storage.module';
import { EncountersController } from './controllers/encounters.controller';
import { EncountersServiceImpl } from './services/impl/encounters.service.impl';
import { ENCOUNTERS_SERVICE_TOKEN } from './services/interfaces/encounters.service.interface';
import { EncountersRepositoryImpl } from './repositories/impl/encounters.repository.impl';
import { ENCOUNTERS_REPOSITORY_TOKEN } from './repositories/interfaces/encounters.repository.interface';
import { EncounterRemindersService } from './services/impl/encounter-reminders.service';
import { AutoScheduleFirstVisitService } from './services/impl/auto-schedule-first-visit.service';
import { PrescriptionsController } from './controllers/prescriptions.controller';
import { PrescriptionsService } from './services/prescriptions.service';
import { MedicalBooksController } from './controllers/medical-books.controller';
import { MedicalBooksService } from './services/medical-books.service';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { Icd10Module } from '../icd10/icd10.module';

@Module({
  imports: [AuthAccessModule, PrismaModule, StorageModule, SchedulingModule, Icd10Module],
  controllers: [EncountersController, PrescriptionsController, MedicalBooksController],
  providers: [
    { provide: ENCOUNTERS_SERVICE_TOKEN, useClass: EncountersServiceImpl },
    { provide: ENCOUNTERS_REPOSITORY_TOKEN, useClass: EncountersRepositoryImpl },
    EncounterRemindersService,
    AutoScheduleFirstVisitService,
    PrescriptionsService,
    MedicalBooksService,
  ],
  exports: [
    ENCOUNTERS_SERVICE_TOKEN,
    ENCOUNTERS_REPOSITORY_TOKEN,
    EncounterRemindersService,
    AutoScheduleFirstVisitService,
  ],
})
export class EncountersModule {}
