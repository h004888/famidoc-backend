import {
  Body,
  Controller,
  Delete,
  Inject,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  CARE_PACKAGES_SERVICE_TOKEN,
  type ICarePackagesService,
} from '../services/interfaces/care-packages.service.interface';
import { carePackagesValidationPipe } from '../care-packages-validation.pipe';
import {
  CreateCarePackageDto,
  ValidateCarePackageDto,
} from '../dtos/create-care-package.dto';
import { AdminListCarePackagesDto } from '../dtos/list-care-packages.dto';
import { UpdateCarePackageDto } from '../dtos/update-care-package.dto';
import { JwtAuthGuard } from '../../../core/auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../../../core/auth/roles.guard';
import type { AuthenticatedRequest } from '../../../core/auth/authenticated-request';
import { ResponseMessage } from '../../../core/decorators/response-message.decorator';

@ApiTags('Care Packages (Admin)')
@ApiBearerAuth('JWT-auth')
@Controller('api/v1/admin/care-packages')
@Roles('ADMIN')
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(carePackagesValidationPipe)
export class AdminCarePackagesController {
  constructor(
    @Inject(CARE_PACKAGES_SERVICE_TOKEN)
    private readonly service: ICarePackagesService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Quản trị viên xem danh sách các gói chăm sóc (mọi trạng thái)' })
  @ApiResponse({ status: 200, description: 'Danh sách gói chăm sóc cho Admin' })
  @ApiResponse({ status: 403, description: 'Chỉ ADMIN mới có quyền truy cập' })
  list(@Query() query: AdminListCarePackagesDto) {
    return this.service.listAdmin(query);
  }

  @Post('validate')
  @ApiOperation({ summary: 'Kiểm tra điều khoản gói theo quy tắc xếp lịch (không lưu)' })
  @ApiBody({ type: ValidateCarePackageDto })
  @ApiResponse({ status: 201, description: 'Danh sách lỗi chặn, thông tin và tải lịch' })
  validate(@Body() dto: ValidateCarePackageDto) {
    return this.service.validate(dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Xem chi tiết gói chăm sóc (bao gồm bản nháp/ngừng bán)' })
  @ApiParam({ name: 'id', description: 'UUID của gói chăm sóc' })
  @ApiResponse({ status: 200, description: 'Chi tiết gói chăm sóc' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy gói' })
  get(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.service.getAdmin(id);
  }

  @Post()
  @ApiOperation({ summary: 'Tạo và mở bán ngay gói chăm sóc mới (Backend tự sinh mã)' })
  @ApiBody({ type: CreateCarePackageDto })
  @ApiResponse({ status: 201, description: 'Gói được tạo thành công và đang mở bán' })
  @ApiResponse({ status: 400, description: 'Dữ liệu không hợp lệ hoặc vi phạm quy tắc xếp lịch' })
  create(@Body() dto: CreateCarePackageDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Cập nhật trực tiếp thông tin gói chăm sóc theo ID' })
  @ApiParam({ name: 'id', description: 'UUID của gói chăm sóc cần cập nhật' })
  @ApiBody({ type: UpdateCarePackageDto })
  @ApiResponse({ status: 200, description: 'Cập nhật thành công' })
  @ApiResponse({ status: 409, description: 'Gói đang ngừng bán' })
  update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateCarePackageDto,
  ) {
    return this.service.update(id, dto);
  }

  @Post(':id/versions')
  @ApiOperation({ summary: 'Tạo phiên bản kế tiếp (next version) từ gói hiện tại' })
  @ApiParam({ name: 'id', description: 'UUID của phiên bản gói hiện tại' })
  @ApiResponse({ status: 201, description: 'Tạo phiên bản mới thành công ở trạng thái DRAFT' })
  createVersion(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.service.createVersion(id);
  }

  @Post(':id/publish')
  @ApiOperation({ summary: 'Xuất bản gói chăm sóc ra công khai (chuyển sang ACTIVE)' })
  @ApiParam({ name: 'id', description: 'UUID của gói cần xuất bản' })
  @ApiResponse({ status: 200, description: 'Xuất bản gói thành công' })
  publish(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.service.publish(id);
  }

  @Post(':id/reopen')
  @ApiOperation({ summary: 'Mở bán lại gói đã ngừng bán' })
  @ApiParam({ name: 'id', description: 'UUID của gói cần mở bán lại' })
  @ApiResponse({ status: 201, description: 'Gói được mở bán lại thành công' })
  @ApiResponse({ status: 409, description: 'Trạng thái gói đã thay đổi hoặc đã có phiên bản mới hơn' })
  reopen(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.service.reopen(id);
  }

  @Post(':id/retire')
  @ApiOperation({ summary: 'Ngừng cung cấp gói chăm sóc (chuyển sang RETIRED)' })
  @ApiParam({ name: 'id', description: 'UUID của gói cần ngừng bán' })
  @ApiResponse({ status: 200, description: 'Ngừng cung cấp gói thành công' })
  retire(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.service.retire(id);
  }

  @Delete(':id')
  @ResponseMessage('Đã xóa gói dịch vụ.')
  @ApiOperation({ summary: 'Xóa mềm gói dịch vụ đã ngừng bán hoặc bản nháp' })
  @ApiParam({ name: 'id', description: 'UUID của gói cần xóa' })
  @ApiResponse({ status: 200, description: 'Đã xóa gói dịch vụ' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy gói dịch vụ' })
  @ApiResponse({ status: 409, description: 'Gói đang mở bán hoặc đang có hợp đồng sử dụng' })
  remove(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.service.remove(id, {
      actorUserId: req.user?.id,
      clientIp: req.ip,
    });
  }
}
