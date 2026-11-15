import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
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
import { Roles, RolesGuard } from '../../../core/auth/roles.guard';
import type { AuthenticatedRequest } from '../../../core/auth/authenticated-request';
import { PlatformContentService } from '../services/platform-content.service';
import { CreateTreatedCaseDto } from '../dtos/create-treated-case.dto';
import { UpdateTreatedCaseDto } from '../dtos/update-treated-case.dto';
import { RejectTreatedCaseDto } from '../dtos/reject-treated-case.dto';

@ApiTags('Doctor Treated Cases (Admin)')
@ApiBearerAuth('JWT-auth')
@Controller('api/v1/admin/doctors/:doctorId/treated-cases')
@Roles('ADMIN')
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
  }),
)
export class AdminTreatedCasesController {
  constructor(private readonly service: PlatformContentService) {}

  @Get()
  @ApiOperation({ summary: 'Quản trị viên xem mọi ca bệnh tiêu biểu của bác sĩ' })
  @ApiParam({ name: 'doctorId', description: 'UUID của bác sĩ' })
  @ApiResponse({ status: 200, description: 'Danh sách ca bệnh mọi trạng thái' })
  @ApiResponse({ status: 403, description: 'Chỉ ADMIN mới có quyền truy cập' })
  list(@Param('doctorId', new ParseUUIDPipe({ version: '4' })) doctorId: string) {
    return this.service.listTreatedCases(doctorId);
  }

  @Post()
  @ApiOperation({ summary: 'Quản trị viên nhập ca bệnh tiêu biểu mới (chờ duyệt)' })
  @ApiParam({ name: 'doctorId', description: 'UUID của bác sĩ' })
  @ApiBody({ type: CreateTreatedCaseDto })
  @ApiResponse({ status: 201, description: 'Tạo ca bệnh ở trạng thái PENDING' })
  @ApiResponse({ status: 400, description: 'Dữ liệu không hợp lệ' })
  create(
    @Param('doctorId', new ParseUUIDPipe({ version: '4' })) doctorId: string,
    @Body() dto: CreateTreatedCaseDto,
  ) {
    return this.service.createTreatedCase(doctorId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Cập nhật nội dung ca bệnh (quay lại chờ duyệt nếu nội dung đổi)' })
  @ApiParam({ name: 'doctorId', description: 'UUID của bác sĩ' })
  @ApiParam({ name: 'id', description: 'UUID của ca bệnh' })
  @ApiBody({ type: UpdateTreatedCaseDto })
  @ApiResponse({ status: 200, description: 'Cập nhật thành công' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy ca bệnh của bác sĩ' })
  update(
    @Param('doctorId', new ParseUUIDPipe({ version: '4' })) doctorId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateTreatedCaseDto,
  ) {
    return this.service.updateTreatedCase(doctorId, id, dto);
  }

  @Post(':id/approve')
  @ApiOperation({ summary: 'Duyệt công khai ca bệnh tiêu biểu' })
  @ApiParam({ name: 'doctorId', description: 'UUID của bác sĩ' })
  @ApiParam({ name: 'id', description: 'UUID của ca bệnh' })
  @ApiResponse({ status: 201, description: 'Ca bệnh được duyệt và công khai' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy ca bệnh của bác sĩ' })
  approve(
    @Param('doctorId', new ParseUUIDPipe({ version: '4' })) doctorId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.approveTreatedCase(doctorId, id, req.user.id);
  }

  @Post(':id/reject')
  @ApiOperation({ summary: 'Từ chối công khai ca bệnh tiêu biểu kèm lý do' })
  @ApiParam({ name: 'doctorId', description: 'UUID của bác sĩ' })
  @ApiParam({ name: 'id', description: 'UUID của ca bệnh' })
  @ApiBody({ type: RejectTreatedCaseDto })
  @ApiResponse({ status: 201, description: 'Ca bệnh bị từ chối và không công khai' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy ca bệnh của bác sĩ' })
  reject(
    @Param('doctorId', new ParseUUIDPipe({ version: '4' })) doctorId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: RejectTreatedCaseDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.rejectTreatedCase(
      doctorId,
      id,
      req.user.id,
      dto.reason,
    );
  }
}
