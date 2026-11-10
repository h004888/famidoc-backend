import { Module } from '@nestjs/common';
import { AuthAccessModule } from '../../core/auth/auth-access.module';
import { PatientsController } from './controllers/patients.controller';
import { PatientsServiceImpl } from './services/impl/patients.service.impl';
import { PATIENTS_SERVICE_TOKEN } from './services/interfaces/patients.service.interface';
import { PatientsRepositoryImpl } from './repositories/impl/patients.repository.impl';
import { PATIENTS_REPOSITORY_TOKEN } from './repositories/interfaces/patients.repository.interface';

@Module({
  imports: [AuthAccessModule],
  controllers: [PatientsController],
  providers: [
    { provide: PATIENTS_SERVICE_TOKEN, useClass: PatientsServiceImpl },
    { provide: PATIENTS_REPOSITORY_TOKEN, useClass: PatientsRepositoryImpl },
  ],
  exports: [PATIENTS_SERVICE_TOKEN, PATIENTS_REPOSITORY_TOKEN],
})
export class PatientsModule {}
