import {
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../../core/auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../../../core/auth/authenticated-request';
import { ListNotificationsDto } from '../dtos/list-notifications.dto';
import {
  NOTIFICATIONS_SERVICE_TOKEN,
  type INotificationsService,
} from '../services/interfaces/notifications.service.interface';
@Controller('api/v1/notifications')
@UseGuards(JwtAuthGuard)
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
  }),
)
export class NotificationsController {
  constructor(
    @Inject(NOTIFICATIONS_SERVICE_TOKEN)
    private readonly service: INotificationsService,
  ) {}
  @Get()
  getUserNotifications(
    @Req() req: AuthenticatedRequest,
    @Query() query: ListNotificationsDto,
  ) {
    return this.service.getUserNotifications(req.user.id, query);
  }
  @Patch(':id/read')
  markNotificationAsRead(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.service.markNotificationAsRead(req.user.id, id);
  }
}
