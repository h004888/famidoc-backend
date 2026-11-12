import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
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
import { Roles, RolesGuard } from '../../../core/auth/roles.guard';
import type { AuthenticatedRequest } from '../../../core/auth/authenticated-request';
import { RegisterFacilityDto } from '../dtos/register-facility.dto';
import { SubmitFacilityLegalProfileDto } from '../dtos/submit-facility-legal-profile.dto';
import { FacilityResponseDto } from '../dtos/facility-response.dto';
import {
  DOCTORS_SERVICE_TOKEN,
  type IDoctorsService,
} from '../services/interfaces/doctors.service.interface';

@ApiTags('Healthcare Facilities Management')
@Controller('api/v1/facilities')
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
  }),
)
export class FacilitiesController {
  constructor(
    @Inject(DOCTORS_SERVICE_TOKEN)
    private readonly service: IDoctorsService,
  ) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Cơ sở y tế gửi đăng ký thông tin cơ bản ban đầu (Public)',
    description:
      'Cơ sở y tế cung cấp thông tin liên hệ và tên cơ sở cơ bản (không cần password, không cần mã số thuế hay giấy phép ban đầu) để gửi yêu cầu cấp tài khoản chờ Quản trị viên xét duyệt.',
  })
  @ApiBody({ type: RegisterFacilityDto })
  @ApiResponse({
    status: 201,
    description:
      'Gửi đăng ký cơ sở y tế thành công, vui lòng chờ Quản trị viên thẩm định và cấp tài khoản qua email.',
    type: FacilityResponseDto,
  })
  @ApiResponse({
    status: 409,
    description: 'Email, số điện thoại hoặc tên cơ sở y tế đã tồn tại trên hệ thống.',
  })
  registerFacility(
    @Body() dto: RegisterFacilityDto,
    @Req() req: any,
  ): Promise<FacilityResponseDto> {
    return this.service.registerFacility(dto, req?.ip ?? 'unknown');
  }

  @Get('me')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('HEALTHCARE_FACILITY')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Cơ sở y tế xem thông tin hồ sơ của chính mình',
  })
  @ApiResponse({
    status: 200,
    description: 'Thông tin chi tiết của cơ sở y tế đang đăng nhập.',
    type: FacilityResponseDto,
  })
  getMyFacility(@Req() req: AuthenticatedRequest): Promise<FacilityResponseDto> {
    return this.service.getMyFacility(req.user);
  }

  @Put('me/legal-profile')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('HEALTHCARE_FACILITY')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary:
      'Cơ sở y tế nộp hồ sơ pháp lý chuyên sâu & tài khoản ngân hàng (Sau khi đăng nhập)',
    description:
      'Sau khi được Admin duyệt cấp tài khoản và đăng nhập thành công, CSYT nộp Giấy phép hoạt động KCB (GPHĐ), Mã số thuế, Thông tin tài khoản ngân hàng thụ hưởng và file scan tài liệu pháp lý để Admin thẩm định pháp lý (Duyệt Lần 2).',
  })
  @ApiBody({ type: SubmitFacilityLegalProfileDto })
  @ApiResponse({
    status: 200,
    description:
      'Nộp hồ sơ pháp lý thành công, chuyển sang trạng thái chờ Quản trị viên thẩm định Cấp 2.',
    type: FacilityResponseDto,
  })
  @ApiResponse({
    status: 409,
    description: 'Số giấy phép hoạt động hoặc mã số thuế đã tồn tại trên hệ thống.',
  })
  submitMyLegalProfile(
    @Req() req: AuthenticatedRequest,
    @Body() dto: SubmitFacilityLegalProfileDto,
  ): Promise<FacilityResponseDto> {
    return this.service.submitFacilityLegalProfile(
      req.user,
      dto,
      req.ip ?? 'unknown',
    );
  }
}
