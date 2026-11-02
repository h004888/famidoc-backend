import { Module } from '@nestjs/common';
import { PrismaModule } from '../../core/database/prisma.module';
import { AuthAccessModule } from '../../core/auth/auth-access.module';
import { FacilitiesDoctorsController } from './controllers/facilities-doctors.controller';
import { DoctorsController } from './controllers/doctors.controller';
import { DoctorsServiceImpl } from './services/impl/doctors.service.impl';
import { DOCTORS_SERVICE_TOKEN } from './services/interfaces/doctors.service.interface';

@Module({
  imports: [PrismaModule, AuthAccessModule],
  controllers: [FacilitiesDoctorsController, DoctorsController],
  providers: [
    {
      provide: DOCTORS_SERVICE_TOKEN,
      useClass: DoctorsServiceImpl,
    },
  ],
  exports: [DOCTORS_SERVICE_TOKEN],
})
export class DoctorsModule {}
