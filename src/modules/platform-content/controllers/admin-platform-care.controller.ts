import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
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
import { Roles, RolesGuard } from '../../../core/auth/roles.guard';
import { PlatformContentService } from '../services/platform-content.service';
import { CreatePlatformCareItemDto } from '../dtos/create-platform-care-item.dto';
import { UpdatePlatformCareItemDto } from '../dtos/update-platform-care-item.dto';

@ApiTags('Platform Care Content (Admin)')
@ApiBearerAuth('JWT-auth')
@Controller('api/v1/admin/platform-care-items')
@Roles('ADMIN')
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
  }),
)
export class AdminPlatformCareController {
  constructor(private readonly service: PlatformContentService) {}

  @Get()
  @ApiOperation({ summary: 'Quản trị viên xem toàn bộ nội dung chăm sóc nền tảng' })
  @ApiResponse({ status: 200, description: 'Danh sách nội dung mọi trạng thái' })
  @ApiResponse({ status: 403, description: 'Chỉ ADMIN mới có quyền truy cập' })
  list() {
    return this.service.listCareItems();
  }

  @Post()
  @ApiOperation({ summary: 'Tạo mục nội dung chăm sóc mới' })
  @ApiBody({ type: CreatePlatformCareItemDto })
  @ApiResponse({ status: 201, description: 'Tạo nội dung thành công' })
  @ApiResponse({ status: 400, description: 'Dữ liệu không hợp lệ' })
  create(@Body() dto: CreatePlatformCareItemDto) {
    return this.service.createCareItem(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Cập nhật nội dung chăm sóc' })
  @ApiParam({ name: 'id', description: 'UUID của mục nội dung' })
  @ApiBody({ type: UpdatePlatformCareItemDto })
  @ApiResponse({ status: 200, description: 'Cập nhật thành công' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy nội dung' })
  update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdatePlatformCareItemDto,
  ) {
    return this.service.updateCareItem(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Ngừng công khai nội dung chăm sóc (xóa mềm)' })
  @ApiParam({ name: 'id', description: 'UUID của mục nội dung' })
  @ApiResponse({ status: 200, description: 'Nội dung được chuyển sang ngừng hoạt động' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy nội dung' })
  deactivate(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.service.deactivateCareItem(id);
  }
}
