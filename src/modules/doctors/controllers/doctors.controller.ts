import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
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
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../core/auth/jwt-auth.guard';
import { RolesGuard, Roles } from '../../../core/auth/roles.guard';
import type { AuthenticatedRequest } from '../../../core/auth/authenticated-request';
import { SubmitDoctorCredentialsDto } from '../dtos/submit-credentials.dto';
import {
  FacilityVerifyCredentialsDto,
  PlatformApproveCredentialsDto,
} from '../dtos/verify-credentials.dto';
import { DoctorResponseDto } from '../dtos/doctor-response.dto';
import {
  DOCTORS_SERVICE_TOKEN,
  type IDoctorsService,
} from '../services/interfaces/doctors.service.interface';

@ApiTags('Doctors Management')
@ApiBearerAuth('JWT-auth')
@Controller('api/v1/doctors')
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
  }),
)
export class DoctorsController {
  constructor(
    @Inject(DOCTORS_SERVICE_TOKEN)
    private readonly service: IDoctorsService,
  ) {}

  @Put(':id/credentials')
  @Roles('DOCTOR', 'ADMIN')
  @ApiOperation({
    summary: 'Bác sĩ tải lên hồ sơ văn bằng, chứng chỉ hành nghề (STT 16 - UC-21)',
    description:
      'Bác sĩ nộp chứng chỉ hành nghề khám chữa bệnh (CCHN), chứng chỉ đào tạo Y học gia đình và văn bằng chuyên môn.',
  })
  @ApiParam({ name: 'id', description: 'UUID của hồ sơ Bác sĩ' })
  @ApiBody({ type: SubmitDoctorCredentialsDto })
  @ApiResponse({
    status: 200,
    description: 'Nộp hồ sơ chứng chỉ thành công, chuyển sang chờ CSYT duyệt cấp 1.',
    type: DoctorResponseDto,
  })
  submitDoctorCredentials(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: SubmitDoctorCredentialsDto,
  ): Promise<DoctorResponseDto> {
    return this.service.submitDoctorCredentials(
      req.user,
      id,
      dto,
      req.ip ?? 'unknown',
    );
  }

  @Patch(':id/credentials/facility-approve')
  @Roles('HEALTHCARE_FACILITY', 'ADMIN')
  @ApiOperation({
    summary: 'Cơ sở y tế thẩm định hồ sơ bác sĩ - Cấp 1 (STT 17 - UC-22)',
    description:
      'Cơ sở y tế trực thuộc kiểm tra, xác thực tính pháp lý của chứng chỉ hành nghề và văn bằng để chuyển sang trạng thái FACILITY_VERIFIED.',
  })
  @ApiParam({ name: 'id', description: 'UUID của hồ sơ Bác sĩ' })
  @ApiBody({ type: FacilityVerifyCredentialsDto })
  @ApiResponse({
    status: 200,
    description: 'Thẩm định cấp 1 thành công.',
    type: DoctorResponseDto,
  })
  approveDoctorCredentialsByFacility(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: FacilityVerifyCredentialsDto,
  ): Promise<DoctorResponseDto> {
    return this.service.approveDoctorCredentialsByFacility(
      req.user,
      id,
      dto,
      req.ip ?? 'unknown',
    );
  }

  @Patch(':id/credentials/platform-approve')
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Quản trị viên Nền tảng phê duyệt cấp chứng nhận - Cấp 2 (STT 18 - UC-22)',
    description:
      'Quản trị viên đối soát với Cơ sở dữ liệu Quốc gia và phê duyệt kích hoạt Bác sĩ sang trạng thái ACTIVE để bắt đầu nhận bệnh nhân.',
  })
  @ApiParam({ name: 'id', description: 'UUID của hồ sơ Bác sĩ' })
  @ApiBody({ type: PlatformApproveCredentialsDto })
  @ApiResponse({
    status: 200,
    description: 'Phê duyệt cấp 2 thành công, bác sĩ đã được kích hoạt ACTIVE.',
    type: DoctorResponseDto,
  })
  approveDoctorCredentialsByPlatform(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: PlatformApproveCredentialsDto,
  ): Promise<DoctorResponseDto> {
    return this.service.approveDoctorCredentialsByPlatform(
      req.user,
      id,
      dto,
      req.ip ?? 'unknown',
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Xem chi tiết hồ sơ bác sĩ' })
  @ApiParam({ name: 'id', description: 'UUID của hồ sơ Bác sĩ' })
  @ApiResponse({
    status: 200,
    description: 'Thông tin hồ sơ bác sĩ.',
    type: DoctorResponseDto,
  })
  getDoctorProfile(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<DoctorResponseDto> {
    return this.service.getDoctorProfile(req.user, id);
  }
}
