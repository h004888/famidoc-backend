import { Module } from '@nestjs/common';
import nodemailer from 'nodemailer';
import { PrismaModule } from '../../core/database/prisma.module';
import { AuthAccessModule } from '../../core/auth/auth-access.module';
import { FacilitiesDoctorsController } from './controllers/facilities-doctors.controller';
import { DoctorsController } from './controllers/doctors.controller';
import { FacilitiesController } from './controllers/facilities.controller';
import { AdminFacilitiesController } from './controllers/admin-facilities.controller';
import { DoctorsServiceImpl } from './services/impl/doctors.service.impl';
import { DOCTORS_SERVICE_TOKEN } from './services/interfaces/doctors.service.interface';

@Module({
  imports: [PrismaModule, AuthAccessModule],
  controllers: [
    FacilitiesDoctorsController,
    DoctorsController,
    FacilitiesController,
    AdminFacilitiesController,
  ],
  providers: [
    {
      provide: DOCTORS_SERVICE_TOKEN,
      useClass: DoctorsServiceImpl,
    },
    {
      provide: 'MAILER_SERVICE',
      useFactory: () => ({
        sendMail: async (options: Record<string, unknown>) => {
          if (!process.env.SMTP_URL || !process.env.MAIL_FROM) {
            return;
          }
          return nodemailer
            .createTransport(process.env.SMTP_URL)
            .sendMail({ ...options, from: process.env.MAIL_FROM });
        },
      }),
    },
  ],
  exports: [DOCTORS_SERVICE_TOKEN],
})
export class DoctorsModule {}
