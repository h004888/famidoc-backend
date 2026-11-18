import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
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
import { BypassTransform } from '../../../core/decorators/bypass-transform.decorator';
import { ResponseMessage } from '../../../core/decorators/response-message.decorator';
import { CreateFacilityDto } from '../dtos/create-facility.dto';
import { VerifyFacilityLegalDto } from '../dtos/verify-facility-legal.dto';
import { FacilityResponseDto } from '../dtos/facility-response.dto';
import {
  createLegalDocumentStream,
  parseFacilityDocumentType,
} from '../utils/legal-document-stream.util';
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

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage(
    'Tạo tài khoản Cơ sở Y tế thành công. Thông tin đăng nhập đã được gửi qua email.',
  )
  @ApiOperation({
    summary: 'Quản trị viên tạo tài khoản mới cho Cơ sở Y tế',
    description:
      'Quản trị viên khởi tạo tài khoản CSYT với mật khẩu ngẫu nhiên an toàn, gửi email thông tin đăng nhập cho CSYT và đặt trạng thái hồ sơ pháp lý là PENDING chờ CSYT nộp hồ sơ.',
  })
  @ApiBody({ type: CreateFacilityDto })
  @ApiResponse({
    status: 201,
    description: 'Tạo tài khoản CSYT thành công.',
    type: FacilityResponseDto,
  })
  @ApiResponse({
    status: 409,
    description: 'Email, số điện thoại hoặc tên cơ sở y tế đã tồn tại.',
  })
  createFacility(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateFacilityDto,
  ): Promise<FacilityResponseDto> {
    return this.service.createFacilityByAdmin(
      req.user,
      dto,
      req.ip ?? 'unknown',
    );
  }

  @Get()
  @ApiOperation({
    summary: 'Quản trị viên xem danh sách các cơ sở y tế trên hệ thống',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    description: 'Lọc theo trạng thái PENDING/ACTIVE/SUSPENDED',
  })
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

  @Get(':id/legal-document')
  @BypassTransform()
  @ApiQuery({
    name: 'type',
    required: false,
    enum: ['operating', 'business'],
    description: 'operating = GPHĐ KBCB (mặc định), business = Giấy chứng nhận ĐKKD',
  })
  @ApiOperation({ summary: 'Tải bản scan hồ sơ pháp lý của CSYT' })
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

  @Patch(':id/verify-legal')
  @ApiOperation({
    summary: 'Quản trị viên thẩm định hồ sơ pháp lý & Kích hoạt đối tác',
    description:
      'Quản trị viên đối soát Giấy phép hoạt động (GPHĐ), Mã số thuế và bản scan hồ sơ pháp lý của CSYT. Khi duyệt thành công, CSYT chuyển sang ACTIVE và đủ điều kiện ký Hợp đồng B2B.',
  })
  @ApiParam({ name: 'id', description: 'UUID của cơ sở y tế' })
  @ApiBody({ type: VerifyFacilityLegalDto })
  @ApiResponse({
    status: 200,
    description:
      'Thẩm định pháp lý thành công, cơ sở y tế đã được kích hoạt ACTIVE hoặc trả về yêu cầu bổ sung.',
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
