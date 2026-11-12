import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
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
import { RolesGuard, Roles } from '../../../core/auth/roles.guard';
import type { AuthenticatedRequest } from '../../../core/auth/authenticated-request';
import { ProvisionDoctorDto } from '../dtos/provision-doctor.dto';
import { DoctorResponseDto } from '../dtos/doctor-response.dto';
import {
  DOCTORS_SERVICE_TOKEN,
  type IDoctorsService,
} from '../services/interfaces/doctors.service.interface';

@ApiTags('Doctors & Facilities Management')
@ApiBearerAuth('JWT-auth')
@Controller(['api/v1/facilities/doctors', 'api/v1/facilities'])
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
  }),
)
export class FacilitiesDoctorsController {
  constructor(
    @Inject(DOCTORS_SERVICE_TOKEN)
    private readonly service: IDoctorsService,
  ) {}

  @Post(['', ':id/doctors'])
  @Roles('HEALTHCARE_FACILITY')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Cơ sở y tế khởi tạo tài khoản Bác sĩ trực thuộc (STT 15 - UC-20)',
    description:
      'Chỉ Cơ sở y tế đối tác mới có quyền tạo tài khoản cho bác sĩ trực thuộc đơn vị mình, thiết lập chuyên khoa, số năm kinh nghiệm và liên kết vào danh sách nhân sự của cơ sở.',
  })
  @ApiBody({ type: ProvisionDoctorDto })
  @ApiResponse({
    status: 201,
    description: 'Khởi tạo tài khoản bác sĩ thành công.',
    type: DoctorResponseDto,
  })
  @ApiResponse({
    status: 409,
    description:
      'Email hoặc số điện thoại của bác sĩ đã tồn tại trên hệ thống.',
  })
  provisionDoctorAccount(
    @Req() req: AuthenticatedRequest,
    @Body() dto: ProvisionDoctorDto,
  ): Promise<DoctorResponseDto> {
    return this.service.provisionDoctorAccount(
      req.user,
      dto,
      req.ip ?? 'unknown',
    );
  }
}
