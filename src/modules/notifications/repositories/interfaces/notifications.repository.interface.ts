import type { Notification } from '@prisma/client';
import type { ListNotificationsDto } from '../../dtos/list-notifications.dto';
export interface NotificationsPage {
  items: Notification[];
  total: number;
  unreadCount: number;
  page: number;
  limit: number;
}
export const NOTIFICATIONS_REPOSITORY_TOKEN = Symbol(
  'NOTIFICATIONS_REPOSITORY',
);
export interface INotificationsRepository {
  getUserNotifications(
    userId: string,
    query: ListNotificationsDto,
  ): Promise<NotificationsPage>;
  markNotificationAsRead(
    userId: string,
    id: string,
  ): Promise<Notification | null>;
}
