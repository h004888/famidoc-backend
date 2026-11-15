import {
  Body,
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
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../core/auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../../../core/auth/roles.guard';
import type { AuthenticatedRequest } from '../../../core/auth/authenticated-request';
import { ApproveFacilityAccountDto } from '../dtos/approve-facility-account.dto';
import { VerifyFacilityLegalDto } from '../dtos/verify-facility-legal.dto';
import { FacilityResponseDto } from '../dtos/facility-response.dto';
import {
  DOCTORS_SERVICE_TOKEN,
  type IDoctorsService,
} from '../services/interfaces/doctors.service.interface';

@ApiTags('Healthcare Facilities Management (Admin)')
@ApiBearerAuth('JWT-auth')
@Controller('api/v1/admin/facilities')
@Roles('ADMIN')
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
  }),
)
export class AdminFacilitiesController {
  constructor(
    @Inject(DOCTORS_SERVICE_TOKEN)
    private readonly service: IDoctorsService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Quản trị viên xem danh sách các cơ sở y tế trên hệ thống',
  })
  @ApiQuery({ name: 'status', required: false, description: 'Lọc theo trạng thái PENDING/ACTIVE/SUSPENDED' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 10 })
  @ApiResponse({
    status: 200,
    description: 'Danh sách các cơ sở y tế kèm phân trang.',
  })
  listFacilities(
    @Req() req: AuthenticatedRequest,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.listFacilitiesForAdmin(req.user, {
      status,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 10,
    });
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Quản trị viên xem chi tiết một cơ sở y tế theo ID',
  })
  @ApiParam({ name: 'id', description: 'UUID của cơ sở y tế' })
  @ApiResponse({
    status: 200,
    description: 'Chi tiết thông tin cơ sở y tế.',
    type: FacilityResponseDto,
  })
  getFacilityDetail(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.service.getFacilityDetailForAdmin(req.user, id);
  }

  @Patch(':id/approve-account')
  @ApiOperation({
    summary: 'Quản trị viên DUYỆT LẦN 1 - Cấp tài khoản cho Cơ sở y tế',
    description:
      'Quản trị viên kiểm tra thông tin đăng ký cơ bản xem cơ sở y tế có thật hay không và phê duyệt cấp tài khoản. Hệ thống tự động sinh mật khẩu khởi tạo an toàn, kích hoạt User và gửi email cấp tài khoản tới CSYT.',
  })
  @ApiParam({ name: 'id', description: 'UUID của cơ sở y tế' })
  @ApiBody({ type: ApproveFacilityAccountDto })
  @ApiResponse({
    status: 200,
    description:
      'Duyệt cấp tài khoản thành công, mật khẩu khởi tạo đã được gửi đến email cơ sở y tế.',
    type: FacilityResponseDto,
  })
  approveFacilityAccount(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: ApproveFacilityAccountDto,
  ): Promise<FacilityResponseDto> {
    return this.service.approveFacilityAccount(
      req.user,
      id,
      dto,
      req.ip ?? 'unknown',
    );
  }

  @Patch(':id/verify-legal')
  @ApiOperation({
    summary: 'Quản trị viên DUYỆT LẦN 2 - Hậu kiểm pháp lý & Kích hoạt đối tác',
    description:
      'Quản trị viên đối soát Giấy phép hoạt động (GPHĐ) và Mã số thuế trên Cổng thông tin CSDL Quốc gia / Bộ Y tế. Khi duyệt thành công, cơ sở y tế chuyển sang ACTIVE và đủ điều kiện để ký Hợp đồng cung ứng nhân lực (B2B Staffing Contract).',
  })
  @ApiParam({ name: 'id', description: 'UUID của cơ sở y tế' })
  @ApiBody({ type: VerifyFacilityLegalDto })
  @ApiResponse({
    status: 200,
    description:
      'Thẩm định pháp lý Cấp 2 thành công, cơ sở y tế đã được kích hoạt ACTIVE sẵn sàng hoạt động.',
    type: FacilityResponseDto,
  })
  verifyFacilityLegal(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: VerifyFacilityLegalDto,
  ): Promise<FacilityResponseDto> {
    return this.service.verifyFacilityLegal(
      req.user,
      id,
      dto,
      req.ip ?? 'unknown',
    );
  }
}
