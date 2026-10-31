import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../core/database/prisma.service';
import type { INotificationsRepository } from '../interfaces/notifications.repository.interface';
import type { ListNotificationsDto } from '../../dtos/list-notifications.dto';
@Injectable()
export class NotificationsRepositoryImpl implements INotificationsRepository {
  constructor(private readonly prisma: PrismaService) {}
  async getUserNotifications(userId: string, query: ListNotificationsDto) {
    const where = {
      userId,
      ...(query.unreadOnly === 'true' ? { isRead: false } : {}),
    };
    // Một snapshot DB cho danh sách và số lượng, tránh lệch trang khi có thông báo mới.
    const [items, total, unreadCount] = await this.prisma.$transaction(
      [
        this.prisma.notification.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        this.prisma.notification.count({ where }),
        this.prisma.notification.count({ where: { userId, isRead: false } }),
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    return { items, total, unreadCount, page: query.page, limit: query.limit };
  }
  async markNotificationAsRead(userId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      // Gắn userId ngay trong UPDATE: không thể đánh dấu thông báo của người khác.
      const changed = await tx.notification.updateMany({
        where: { id, userId },
        data: { isRead: true },
      });
      return changed.count
        ? tx.notification.findUnique({ where: { id } })
        : null;
    });
  }
}
