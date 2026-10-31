import { ContractsModule } from './modules/contracts/contracts.module';
import { FinanceModule } from './modules/finance/finance.module';
import { ReviewsModule } from './modules/reviews/reviews.module';
import { ComplaintsModule } from './modules/complaints/complaints.module';
import { UsersModule } from './modules/users/users.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './core/database/prisma.module';
import { HealthController } from './core/health/health.controller';
import { AuthModule } from './modules/auth/auth.module';

import { CarePackagesModule } from './modules/care-packages/care-packages.module';
import { PaymentsModule } from './modules/payments/payments.module';

@Module({
  // Các module nghiệp vụ dùng chung Prisma và cơ chế xác thực của backend.
  imports: [
    PrismaModule,
    AuthModule,
    CarePackagesModule,
    PaymentsModule,
    ContractsModule,
    FinanceModule,
    ReviewsModule,
    ComplaintsModule,
    UsersModule,
    NotificationsModule,
  ],
  controllers: [AppController, HealthController],
  providers: [AppService],
})
export class AppModule {}
