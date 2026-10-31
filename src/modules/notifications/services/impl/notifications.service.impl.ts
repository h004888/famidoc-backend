import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  NOTIFICATIONS_REPOSITORY_TOKEN,
  type INotificationsRepository,
} from '../../repositories/interfaces/notifications.repository.interface';
import type { INotificationsService } from '../interfaces/notifications.service.interface';
import type { ListNotificationsDto } from '../../dtos/list-notifications.dto';
@Injectable()
export class NotificationsServiceImpl implements INotificationsService {
  constructor(
    @Inject(NOTIFICATIONS_REPOSITORY_TOKEN)
    private readonly repository: INotificationsRepository,
  ) {}
  getUserNotifications(userId: string, query: ListNotificationsDto) {
    return this.repository.getUserNotifications(userId, query);
  }
  async markNotificationAsRead(userId: string, id: string) {
    const item = await this.repository.markNotificationAsRead(userId, id);
    // 404 cho cả ID không tồn tại và ID không thuộc mình, tránh tiết lộ dữ liệu.
    if (!item) throw new NotFoundException('Notification not found');
    return item;
  }
}
