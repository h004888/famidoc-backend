import {
  Body,
  Controller,
  Inject,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
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
import { CARE_PACKAGES_SERVICE_TOKEN, type ICarePackagesService } from '../services/interfaces/care-packages.service.interface';
import { carePackagesValidationPipe } from '../care-packages-validation.pipe';
import { CreateCarePackageDto } from '../dtos/create-care-package.dto';
import { AdminListCarePackagesDto } from '../dtos/list-care-packages.dto';
import { UpdateCarePackageDto } from '../dtos/update-care-package.dto';
import { JwtAuthGuard } from '../../../core/auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../../../core/auth/roles.guard';

@ApiTags('Care Packages (Admin)')
@ApiBearerAuth('JWT-auth')
@Controller('api/v1/admin/care-packages') // Tiền tố chung cho các API quản trị gói.
@Roles('ADMIN')
@UseGuards(JwtAuthGuard, RolesGuard) // Kiểm tra quyền trước mọi phương thức trong controller.
@UsePipes(carePackagesValidationPipe) // Kiểm tra body/query bằng các DTO tương ứng.
export class AdminCarePackagesController {
  constructor(@Inject(CARE_PACKAGES_SERVICE_TOKEN) private readonly service: ICarePackagesService) {}

  @Get()
  @ApiOperation({ summary: 'Quản trị viên xem danh sách các gói chăm sóc (mọi trạng thái)' })
  @ApiResponse({ status: 200, description: 'Danh sách gói chăm sóc cho Admin' })
  @ApiResponse({ status: 403, description: 'Chỉ ADMIN mới có quyền truy cập' })
  list(@Query() query: AdminListCarePackagesDto) {
    // Cho quản trị xem các trạng thái, có phân trang và bộ lọc status tùy chọn.
    return this.service.listAdmin(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Xem chi tiết gói chăm sóc (bao gồm bản nháp/ngừng bán)' })
  @ApiParam({ name: 'id', description: 'UUID của gói chăm sóc' })
  @ApiResponse({ status: 200, description: 'Chi tiết gói chăm sóc' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy gói' })
  get(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    // Chặn ID sai định dạng trước khi tra cứu; quản trị được xem cả bản nháp/ngừng bán.
    return this.service.getAdmin(id);
  }

  @Post()
  @ApiOperation({ summary: 'Tạo và mở bán ngay gói chăm sóc mới' })
  @ApiBody({ type: CreateCarePackageDto })
  @ApiResponse({ status: 201, description: 'Gói được tạo thành công và đang mở bán' })
  @ApiResponse({ status: 400, description: 'Dữ liệu không hợp lệ' })
  create(@Body() dto: CreateCarePackageDto) {
    // Controller chỉ chuyển DTO hợp lệ sang service, không tự tạo ID hay phiên bản.
    return this.service.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Cập nhật trực tiếp thông tin gói chăm sóc theo ID' })
  @ApiParam({ name: 'id', description: 'UUID của gói chăm sóc cần cập nhật' })
  @ApiBody({ type: UpdateCarePackageDto })
  @ApiResponse({ status: 200, description: 'Cập nhật thành công' })
  @ApiResponse({ status: 409, description: 'Gói đang ngừng bán, cần mở bán lại trước khi chỉnh sửa' })
  update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateCarePackageDto,
  ) {
    // Lưu trên đúng gói hiện tại để giữ nguyên ID và số phiên bản.
    return this.service.update(id, dto);
  }

  @Post(':id/versions')
  @ApiOperation({ summary: 'Tạo phiên bản kế tiếp (next version) từ gói hiện tại' })
  @ApiParam({ name: 'id', description: 'UUID của phiên bản gói hiện tại' })
  @ApiResponse({ status: 201, description: 'Tạo phiên bản mới thành công ở trạng thái DRAFT' })
  createVersion(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    // Tạo bản nháp kế tiếp từ phiên bản mới nhất, không ghi đè bản đã công bố.
    return this.service.createVersion(id);
  }

  @Post(':id/publish')
  @ApiOperation({ summary: 'Xuất bản gói chăm sóc ra công khai (chuyển sang ACTIVE)' })
  @ApiParam({ name: 'id', description: 'UUID của gói cần xuất bản' })
  @ApiResponse({ status: 200, description: 'Xuất bản gói thành công' })
  publish(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    // Công bố để gói xuất hiện ở danh mục công khai; không phải thao tác thanh toán.
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
    // Ngừng nhận mua mới, không xóa lịch sử và không tự hủy hợp đồng hiện có.
    return this.service.retire(id);
  }
}
