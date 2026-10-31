import { Module } from '@nestjs/common';
import { AuthAccessModule } from '../../core/auth/auth-access.module';
import { NotificationsController } from './controllers/notifications.controller';
import { NotificationsServiceImpl } from './services/impl/notifications.service.impl';
import { NOTIFICATIONS_SERVICE_TOKEN } from './services/interfaces/notifications.service.interface';
import { NotificationsRepositoryImpl } from './repositories/impl/notifications.repository.impl';
import { NOTIFICATIONS_REPOSITORY_TOKEN } from './repositories/interfaces/notifications.repository.interface';
@Module({
  imports: [AuthAccessModule],
  controllers: [NotificationsController],
  providers: [
    {
      provide: NOTIFICATIONS_SERVICE_TOKEN,
      useClass: NotificationsServiceImpl,
    },
    {
      provide: NOTIFICATIONS_REPOSITORY_TOKEN,
      useClass: NotificationsRepositoryImpl,
    },
  ],
})
export class NotificationsModule {}
