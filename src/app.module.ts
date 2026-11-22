import { ContractsModule } from './modules/contracts/contracts.module';
import { PatientsModule } from './modules/patients/patients.module';
import { FinanceModule } from './modules/finance/finance.module';
import { ReviewsModule } from './modules/reviews/reviews.module';
import { ComplaintsModule } from './modules/complaints/complaints.module';
import { UsersModule } from './modules/users/users.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './core/database/prisma.module';
import { CoreMailerModule } from './core/mailer/core-mailer.module';
import { HealthController } from './core/health/health.controller';
import { AuthModule } from './modules/auth/auth.module';

import { PublicModule } from './modules/public/public.module';
import { DoctorsModule } from './modules/doctors/doctors.module';
import { CarePackagesModule } from './modules/care-packages/care-packages.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { PlatformContentModule } from './modules/platform-content/platform-content.module';
import { EncountersModule } from './modules/encounters/encounters.module';
import { TelehealthModule } from './modules/telehealth/telehealth.module';
import { AdminModule } from './modules/admin/admin.module';
import { MatchingModule } from './modules/matching/matching.module';

@Module({
  // Các module nghiệp vụ dùng chung Prisma và cơ chế xác thực của backend.
  imports: [
    PrismaModule,
    CoreMailerModule,
    PublicModule,
    DoctorsModule,
    AuthModule,
    CarePackagesModule,
    PaymentsModule,
    ContractsModule,
    FinanceModule,
    ReviewsModule,
    ComplaintsModule,
    UsersModule,
    NotificationsModule,
    PatientsModule,
    PlatformContentModule,
    EncountersModule,
    TelehealthModule,
    AdminModule,
    MatchingModule,
  ],
  controllers: [AppController, HealthController],
  providers: [AppService],
})
export class AppModule {}
