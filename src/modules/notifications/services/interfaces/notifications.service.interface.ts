import type { Notification } from '@prisma/client';
import type { ListNotificationsDto } from '../../dtos/list-notifications.dto';
import type { NotificationsPage } from '../../repositories/interfaces/notifications.repository.interface';
export const NOTIFICATIONS_SERVICE_TOKEN = Symbol('NOTIFICATIONS_SERVICE');
export interface INotificationsService {
  getUserNotifications(
    userId: string,
    query: ListNotificationsDto,
  ): Promise<NotificationsPage>;
  markNotificationAsRead(userId: string, id: string): Promise<Notification>;
}
