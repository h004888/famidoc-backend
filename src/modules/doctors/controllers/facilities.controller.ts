import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
  Req,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { BypassTransform } from '../../../core/decorators/bypass-transform.decorator';
import { ResponseMessage } from '../../../core/decorators/response-message.decorator';
import { AllowOnboarding } from '../../../core/auth/allow-onboarding.decorator';
import { JwtAuthGuard } from '../../../core/auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../../../core/auth/roles.guard';
import type { AuthenticatedRequest } from '../../../core/auth/authenticated-request';
import { SubmitFacilityLegalProfileDto } from '../dtos/submit-facility-legal-profile.dto';
import { FacilityResponseDto } from '../dtos/facility-response.dto';
import { FacilityOverviewResponseDto } from '../dtos/facility-overview-response.dto';
import {
  DOCTORS_SERVICE_TOKEN,
  type IDoctorsService,
  type UploadedFacilityLegalFiles,
} from '../services/interfaces/doctors.service.interface';
import {
  createLegalDocumentStream,
  parseFacilityDocumentType,
} from '../utils/legal-document-stream.util';

const FACILITY_LEGAL_UPLOAD_FIELDS = [
  { name: 'operatingLicenseFile', maxCount: 1 },
  { name: 'file', maxCount: 1 },
  { name: 'businessLicenseFile', maxCount: 1 },
];

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

  @Get('me')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('HEALTHCARE_FACILITY')
  @AllowOnboarding()
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

  @Get('me/overview')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('HEALTHCARE_FACILITY')
  @AllowOnboarding()
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Cơ sở y tế xem số liệu tổng hợp vận hành theo thời gian thực',
  })
  @ApiResponse({
    status: 200,
    description: 'Số liệu tổng hợp vận hành của cơ sở y tế đang đăng nhập.',
    type: FacilityOverviewResponseDto,
  })
  getMyFacilityOverview(
    @Req() req: AuthenticatedRequest,
  ): Promise<FacilityOverviewResponseDto> {
    return this.service.getMyFacilityOverview(req.user);
  }

  @Put('me/legal-profile')
  @UseInterceptors(
    FileFieldsInterceptor(FACILITY_LEGAL_UPLOAD_FIELDS, {
      limits: { fileSize: 10 * 1024 * 1024, files: 2 },
    }),
  )
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('HEALTHCARE_FACILITY')
  @AllowOnboarding()
  @ApiBearerAuth('JWT-auth')
  @ApiConsumes('multipart/form-data')
  @ResponseMessage(
    'Nộp hồ sơ pháp lý cơ sở y tế thành công, chuyển sang chờ Quản trị viên thẩm định',
  )
  @ApiOperation({
    summary: 'Cơ sở y tế nộp hồ sơ pháp lý chuyên sâu & tài khoản ngân hàng',
    description:
      'Sau khi được Admin tạo tài khoản và đăng nhập, CSYT nộp GPHĐ KBCB, Mã số thuế, Địa chỉ trụ sở, Tài khoản ngân hàng thụ hưởng và 2 tệp scan riêng (GPHĐ KBCB & Giấy chứng nhận ĐKKD, tối đa 10MB/tệp) để Admin thẩm định.',
  })
  @ApiBody({ type: SubmitFacilityLegalProfileDto })
  @ApiResponse({
    status: 200,
    description:
      'Nộp hồ sơ pháp lý thành công, chuyển sang trạng thái chờ Quản trị viên thẩm định.',
    type: FacilityResponseDto,
  })
  @ApiResponse({
    status: 409,
    description: 'Số giấy phép hoạt động hoặc mã số thuế đã tồn tại trên hệ thống.',
  })
  submitMyLegalProfile(
    @Req() req: AuthenticatedRequest,
    @Body() dto: SubmitFacilityLegalProfileDto,
    @UploadedFiles() files?: UploadedFacilityLegalFiles,
  ): Promise<FacilityResponseDto> {
    return this.service.submitFacilityLegalProfile(
      req.user,
      dto,
      req.ip ?? 'unknown',
      files,
    );
  }

  @Get('me/legal-document')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('HEALTHCARE_FACILITY')
  @AllowOnboarding()
  @BypassTransform()
  @ApiBearerAuth('JWT-auth')
  @ApiQuery({
    name: 'type',
    required: false,
    enum: ['operating', 'business'],
    description: 'operating = GPHĐ KBCB (mặc định), business = Giấy chứng nhận ĐKKD',
  })
  @ApiOperation({
    summary: 'Cơ sở y tế xem lại bản scan hồ sơ pháp lý của chính mình',
  })
  async getMyLegalDocument(
    @Req() req: AuthenticatedRequest,
    @Query('type') type?: string,
  ) {
    const docType = parseFacilityDocumentType(type);
    const { bytes, contentType } =
      await this.service.getFacilityLegalDocument('me', req.user, docType);
    return createLegalDocumentStream(bytes, contentType);
  }

  @Get(':id/legal-document')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'HEALTHCARE_FACILITY')
  @AllowOnboarding()
  @BypassTransform()
  @ApiBearerAuth('JWT-auth')
  @ApiParam({ name: 'id', description: 'UUID của cơ sở y tế' })
  @ApiQuery({
    name: 'type',
    required: false,
    enum: ['operating', 'business'],
    description: 'operating = GPHĐ KBCB (mặc định), business = Giấy chứng nhận ĐKKD',
  })
  @ApiOperation({
    summary: 'Tải/xem bản scan hồ sơ pháp lý của CSYT (Admin hoặc CSYT chính chủ)',
  })
  async getLegalDocument(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query('type') type?: string,
  ) {
    const docType = parseFacilityDocumentType(type);
    const { bytes, contentType } =
      await this.service.getFacilityLegalDocument(id, req.user, docType);
    return createLegalDocumentStream(bytes, contentType);
  }
}
