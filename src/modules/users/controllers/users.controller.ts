import {
  Body,
  Controller,
  Get,
  Inject,
  Put,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../core/auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../../../core/auth/authenticated-request';
import { UpdateProfileDto } from '../dtos/update-profile.dto';
import {
  USERS_SERVICE_TOKEN,
  type IUsersService,
} from '../services/interfaces/users.service.interface';

@ApiTags('Users')
@ApiBearerAuth('JWT-auth')
@Controller('api/v1/users')
@UseGuards(JwtAuthGuard)
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
  }),
)
export class UsersController {
  constructor(
    @Inject(USERS_SERVICE_TOKEN) private readonly service: IUsersService,
  ) {}

  @Get('profile')
  @ApiOperation({ summary: 'Lấy thông tin hồ sơ của người dùng hiện tại' })
  @ApiResponse({ status: 200, description: 'Lấy thông tin hồ sơ thành công' })
  @ApiResponse({ status: 401, description: 'Chưa xác thực' })
  getCurrentUserProfile(@Req() req: AuthenticatedRequest) {
    return this.service.getCurrentUserProfile(req.user.id);
  }

  @Put('profile')
  @ApiOperation({ summary: 'Cập nhật thông tin hồ sơ cá nhân' })
  @ApiBody({ type: UpdateProfileDto })
  @ApiResponse({ status: 200, description: 'Cập nhật hồ sơ thành công' })
  @ApiResponse({ status: 400, description: 'Dữ liệu không hợp lệ' })
  @ApiResponse({ status: 401, description: 'Chưa xác thực' })
  updateUserProfile(
    @Req() req: AuthenticatedRequest,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.service.updateUserProfile(req.user.id, dto);
  }
}
