import {
  Body,
  Controller,
  Inject,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UsePipes,
} from '@nestjs/common';
import {
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CARE_PACKAGES_SERVICE_TOKEN, type ICarePackagesService } from '../services/interfaces/care-packages.service.interface';
import { carePackagesValidationPipe } from '../care-packages-validation.pipe';
import { ListCarePackagesDto } from '../dtos/list-care-packages.dto';
import { QuoteCarePackageDto } from '../dtos/quote-care-package.dto';

// API danh mục/báo giá công khai, không yêu cầu đăng nhập và không thay đổi dữ liệu.
@ApiTags('Care Packages (Public)')
@Controller('api/v1/care-packages')
@UsePipes(carePackagesValidationPipe)
export class CarePackagesController {
  constructor(@Inject(CARE_PACKAGES_SERVICE_TOKEN) private readonly service: ICarePackagesService) {}

  @Get()
  @ApiOperation({ summary: 'Lấy danh mục các gói chăm sóc sức khỏe đang hoạt động (ACTIVE)' })
  @ApiResponse({ status: 200, description: 'Danh sách các gói chăm sóc công khai' })
  list(@Query() query: ListCarePackagesDto) {
    // DTO cấp page/limit mặc định; service luôn giới hạn kết quả ở trạng thái ACTIVE.
    return this.service.listPublic(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Xem chi tiết phiên bản gói chăm sóc theo ID' })
  @ApiParam({ name: 'id', description: 'UUID của phiên bản gói chăm sóc' })
  @ApiResponse({ status: 200, description: 'Chi tiết gói chăm sóc' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy gói chăm sóc' })
  get(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    // id là UUID từng phiên bản, khác với mã gói code dùng chung qua các phiên bản.
    return this.service.getPublic(id);
  }

  @Post(':id/quote')
  @HttpCode(HttpStatus.OK) // Chỉ tính kết quả, không tạo bản ghi nên trả 200 thay vì 201.
  @ApiOperation({ summary: 'Tính báo giá gói chăm sóc theo số lượng thành viên' })
  @ApiParam({ name: 'id', description: 'UUID của phiên bản gói chăm sóc' })
  @ApiBody({ type: QuoteCarePackageDto })
  @ApiResponse({ status: 200, description: 'Báo giá chi tiết đã tính toán' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy gói chăm sóc' })
  quote(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: QuoteCarePackageDto,
  ) {
    // Body chỉ có memberCount; ID phiên bản gói lấy từ đường dẫn đã kiểm tra UUID.
    return this.service.quote(id, dto);
  }
}
