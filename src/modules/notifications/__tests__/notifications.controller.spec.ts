import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsController } from '../controllers/notifications.controller';
import {
  NOTIFICATIONS_SERVICE_TOKEN,
  INotificationsService,
} from '../services/interfaces/notifications.service.interface';
import { JwtAuthGuard } from '../../../core/auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../../../core/auth/authenticated-request';

describe('NotificationsController (/me/notifications alias)', () => {
  let controller: NotificationsController;
  let service: jest.Mocked<INotificationsService>;

  const mockReq = {
    user: { id: 'user-uuid-1', role: 'FAMILY_REP' },
  } as unknown as AuthenticatedRequest;

  const mockNotification = {
    id: 'notif-uuid-1',
    userId: 'user-uuid-1',
    title: 'Thông báo mới',
    content: 'Nội dung thông báo',
    type: 'CONTRACT',
    referenceId: 'ref-1',
    isRead: false,
    createdAt: new Date(),
  };

  beforeEach(async () => {
    service = {
      getUserNotifications: jest.fn().mockResolvedValue({
        items: [mockNotification],
        total: 1,
      }),
      markNotificationAsRead: jest.fn().mockResolvedValue({
        ...mockNotification,
        isRead: true,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [
        {
          provide: NOTIFICATIONS_SERVICE_TOKEN,
          useValue: service,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<NotificationsController>(NotificationsController);
  });

  it('should support /me/notifications alias in controller path metadata', () => {
    const path = Reflect.getMetadata('path', NotificationsController);
    const paths = Array.isArray(path) ? path : [path];
    expect(paths).toContain('api/v1/me/notifications');
    expect(paths).toContain('api/v1/notifications');
  });

  it('should delegate getUserNotifications to service', async () => {
    const query = { page: 1, limit: 10 };
    const result = await controller.getUserNotifications(mockReq, query);
    expect(result.items).toHaveLength(1);
    expect(service.getUserNotifications).toHaveBeenCalledWith(
      'user-uuid-1',
      query,
    );
  });

  it('should delegate markNotificationAsRead to service', async () => {
    const result = await controller.markNotificationAsRead(
      mockReq,
      'notif-uuid-1',
    );
    expect(result.isRead).toBe(true);
    expect(service.markNotificationAsRead).toHaveBeenCalledWith(
      'user-uuid-1',
      'notif-uuid-1',
    );
  });
});
