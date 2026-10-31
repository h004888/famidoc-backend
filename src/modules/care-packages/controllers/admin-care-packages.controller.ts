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
import { CARE_PACKAGES_SERVICE_TOKEN, type ICarePackagesService } from '../services/interfaces/care-packages.service.interface';
import { carePackagesValidationPipe } from '../care-packages-validation.pipe';
import { CreateCarePackageDto } from '../dtos/create-care-package.dto';
import { AdminListCarePackagesDto } from '../dtos/list-care-packages.dto';
import { UpdateCarePackageDto } from '../dtos/update-care-package.dto';
import { JwtAuthGuard } from '../../../core/auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../../../core/auth/roles.guard';

@Controller('api/v1/admin/care-packages') // Tiền tố chung cho các API quản trị gói.
@Roles('ADMIN')
@UseGuards(JwtAuthGuard, RolesGuard) // Kiểm tra quyền trước mọi phương thức trong controller.
@UsePipes(carePackagesValidationPipe) // Kiểm tra body/query bằng các DTO tương ứng.
export class AdminCarePackagesController {
  constructor(@Inject(CARE_PACKAGES_SERVICE_TOKEN) private readonly service: ICarePackagesService) {}

  @Get()
  list(@Query() query: AdminListCarePackagesDto) {
    // Cho quản trị xem các trạng thái, có phân trang và bộ lọc status tùy chọn.
    return this.service.listAdmin(query);
  }

  @Get(':id')
  get(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    // Chặn ID sai định dạng trước khi tra cứu; quản trị được xem cả bản nháp/ngừng bán.
    return this.service.getAdmin(id);
  }

  @Post()
  create(@Body() dto: CreateCarePackageDto) {
    // Controller chỉ chuyển DTO hợp lệ sang service, không tự tạo ID hay phiên bản.
    return this.service.create(dto);
  }

  @Patch(':id')
  update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateCarePackageDto,
  ) {
    // Chỉ service quyết định bản ghi còn được sửa hay phải tạo phiên bản mới.
    return this.service.update(id, dto);
  }

  @Post(':id/versions')
  createVersion(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    // Tạo bản nháp kế tiếp từ phiên bản mới nhất, không ghi đè bản đã công bố.
    return this.service.createVersion(id);
  }

  @Post(':id/publish')
  publish(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    // Công bố để gói xuất hiện ở danh mục công khai; không phải thao tác thanh toán.
    return this.service.publish(id);
  }

  @Post(':id/retire')
  retire(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    // Ngừng nhận mua mới, không xóa lịch sử và không tự hủy hợp đồng hiện có.
    return this.service.retire(id);
  }
}
