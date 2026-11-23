import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../core/auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../../../core/auth/authenticated-request';
import {
  ListComplaintsQueryDto,
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

  @Get()
  @ApiOperation({
    summary: 'Xem danh sách khiếu nại thuộc phạm vi phân quyền của tài khoản hiện tại',
  })
  @ApiResponse({ status: 200, description: 'Danh sách khiếu nại phân trang' })
  listComplaints(
    @Req() req: AuthenticatedRequest,
    @Query() query: ListComplaintsQueryDto,
  ) {
    return this.service.listComplaints(req.user, query);
  }

  @Post('evidence')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 0 },
    }),
  )
  @ApiOperation({ summary: 'Tải lên tệp bằng chứng cho khiếu nại (PDF, PNG, JPEG tối đa 5 MB)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiResponse({ status: 201, description: 'Tải tệp bằng chứng thành công' })
  uploadEvidence(
    @Req() req: AuthenticatedRequest,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.service.uploadComplaintEvidence(req.user, file);
  }

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
