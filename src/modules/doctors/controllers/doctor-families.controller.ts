import {
  Controller,
  Get,
  Header,
  Param,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../../../core/auth/authenticated-request';
import { JwtAuthGuard } from '../../../core/auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../../../core/auth/roles.guard';
import { DoctorFamilyParamsDto } from '../dtos/doctor-family-params.dto';
import { DoctorFamiliesService } from '../services/doctor-families.service';

@ApiTags('Doctors Management')
@ApiBearerAuth('JWT-auth')
@Controller('api/v1/doctors/me/families')
@Roles('DOCTOR')
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
  }),
)
export class DoctorFamiliesController {
  constructor(private readonly service: DoctorFamiliesService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Bác sĩ xem danh sách hộ gia đình mình phụ trách',
    description:
      'Trả toàn bộ hộ gia đình có hợp đồng với bác sĩ, kèm hợp đồng mới nhất.',
  })
  list(@Req() req: AuthenticatedRequest) {
    return this.service.list(req.user);
  }

  @Get(':familyId')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Bác sĩ xem chi tiết thành viên của một hộ gia đình',
  })
  detail(
    @Req() req: AuthenticatedRequest,
    @Param() params: DoctorFamilyParamsDto,
  ) {
    return this.service.detail(req.user, params.familyId);
  }
}
