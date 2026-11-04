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
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../core/auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../../../core/auth/authenticated-request';
import { ListNotificationsDto } from '../dtos/list-notifications.dto';
import {
  NOTIFICATIONS_SERVICE_TOKEN,
  type INotificationsService,
} from '../services/interfaces/notifications.service.interface';

@ApiTags('Notifications')
@ApiBearerAuth('JWT-auth')
@Controller(['api/v1/notifications', 'api/v1/me/notifications'])
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
  @ApiOperation({ summary: 'Lấy danh sách thông báo của người dùng hiện tại' })
  @ApiResponse({ status: 200, description: 'Danh sách thông báo người dùng' })
  getUserNotifications(
    @Req() req: AuthenticatedRequest,
    @Query() query: ListNotificationsDto,
  ) {
    return this.service.getUserNotifications(req.user.id, query);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Đánh dấu thông báo đã đọc theo ID' })
  @ApiParam({ name: 'id', description: 'UUID của thông báo' })
  @ApiResponse({
    status: 200,
    description: 'Đã đánh dấu thông báo đọc thành công',
  })
  @ApiResponse({ status: 404, description: 'Không tìm thấy thông báo' })
  markNotificationAsRead(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.service.markNotificationAsRead(req.user.id, id);
  }
}
