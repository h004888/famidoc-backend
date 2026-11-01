import {
  Body,
  Controller,
  Get,
  Inject,
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
import type { AuthenticatedRequest } from '../../../core/auth/authenticated-request';
import {
  ResolveComplaintDto,
  SubmitIncidentComplaintDto,
} from '../dtos/complaint.dto';
import {
  COMPLAINTS_SERVICE_TOKEN,
  type IComplaintsService,
} from '../services/interfaces/complaints.service.interface';

@ApiTags('Complaints')
@ApiBearerAuth('JWT-auth')
@Controller('api/v1/complaints')
@UseGuards(JwtAuthGuard)
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
export class ComplaintsController {
  constructor(
    @Inject(COMPLAINTS_SERVICE_TOKEN)
    private readonly service: IComplaintsService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Gửi khiếu nại sự cố liên quan đến dịch vụ hoặc bác sĩ' })
  @ApiBody({ type: SubmitIncidentComplaintDto })
  @ApiResponse({ status: 201, description: 'Gửi khiếu nại thành công' })
  @ApiResponse({ status: 400, description: 'Dữ liệu không hợp lệ' })
  submitIncidentComplaint(
    @Req() req: AuthenticatedRequest,
    @Body() dto: SubmitIncidentComplaintDto,
  ) {
    return this.service.submitIncidentComplaint(req.user, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Xem thông tin chi tiết của một khiếu nại' })
  @ApiParam({ name: 'id', description: 'UUID của khiếu nại' })
  @ApiResponse({ status: 200, description: 'Thông tin chi tiết khiếu nại' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy khiếu nại' })
  getComplaintDetail(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.service.getComplaintDetail(req.user, id);
  }

  @Patch(':id/resolve')
  @ApiOperation({ summary: 'Giải quyết / cập nhật kết quả xử lý khiếu nại' })
  @ApiParam({ name: 'id', description: 'UUID của khiếu nại cần xử lý' })
  @ApiBody({ type: ResolveComplaintDto })
  @ApiResponse({ status: 200, description: 'Cập nhật giải quyết khiếu nại thành công' })
  @ApiResponse({ status: 400, description: 'Trạng thái khiếu nại không hợp lệ để xử lý' })
  resolveComplaint(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: ResolveComplaintDto,
  ) {
    return this.service.resolveComplaint(req.user, id, dto);
  }
}
