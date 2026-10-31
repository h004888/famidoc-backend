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
import { JwtAuthGuard } from '../../../core/auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../../../core/auth/authenticated-request';
import { UpdateProfileDto } from '../dtos/update-profile.dto';
import {
  USERS_SERVICE_TOKEN,
  type IUsersService,
} from '../services/interfaces/users.service.interface';
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
  getCurrentUserProfile(@Req() req: AuthenticatedRequest) {
    return this.service.getCurrentUserProfile(req.user.id);
  }
  @Put('profile')
  updateUserProfile(
    @Req() req: AuthenticatedRequest,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.service.updateUserProfile(req.user.id, dto);
  }
}
