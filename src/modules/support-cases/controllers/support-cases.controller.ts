import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
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
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../../../core/auth/authenticated-request';
import { JwtAuthGuard } from '../../../core/auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../../../core/auth/roles.guard';
import {
  CreateComplaintSupportCaseDto,
  CreatePaymentIssueCaseDto,
  DownloadSupportAttachmentQueryDto,
  ListSupportCasesQueryDto,
  PostSupportMessageDto,
  UpdateSupportCaseStatusDto,
} from '../dtos/support-case.dto';
import { SupportCasesService } from '../services/support-cases.service';

@ApiTags('Support Cases')
@ApiBearerAuth('JWT-auth')
@Controller('api/v1/support-cases')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('FAMILY_REP', 'ADMIN')
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
export class SupportCasesController {
  constructor(private readonly service: SupportCasesService) {}

  @Get()
  @ApiOperation({
    summary:
      'Danh sách hồ sơ hỗ trợ (xem xét lại khiếu nại, câu hỏi khiếu nại và báo lỗi chuyển khoản)',
  })
  @ApiResponse({ status: 200, description: 'Danh sách hồ sơ hỗ trợ phân trang' })
  listCases(
    @Req() req: AuthenticatedRequest,
    @Query() query: ListSupportCasesQueryDto,
  ) {
    return this.service.listCases(req.user, query);
  }

  @Post('attachments')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 0 },
    }),
  )
  @ApiOperation({
    summary:
      'Tải lên tệp biên lai chuyển khoản hoặc bằng chứng bổ sung (PDF, PNG, JPEG tối đa 5 MB)',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiResponse({ status: 201, description: 'Tải tệp đính kèm thành công' })
  uploadAttachment(
    @Req() req: AuthenticatedRequest,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.service.uploadAttachment(req.user, file);
  }

  @Post('complaint-review')
  @Roles('FAMILY_REP')
  @ApiOperation({
    summary:
      'Gia đình gửi yêu cầu xem xét lại hoặc đặt câu hỏi trong hồ sơ khiếu nại đã có kết quả',
  })
  @ApiBody({ type: CreateComplaintSupportCaseDto })
  @ApiResponse({ status: 201, description: 'Tạo hồ sơ hỗ trợ thành công' })
  createComplaintCase(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateComplaintSupportCaseDto,
  ) {
    return this.service.createComplaintCase(req.user, dto);
  }

  @Post('payment-issue')
  @Roles('FAMILY_REP')
  @ApiOperation({
    summary:
      'Gia đình gửi báo lỗi chuyển khoản kèm tự động điền thông tin hóa đơn và giao dịch SePay',
  })
  @ApiBody({ type: CreatePaymentIssueCaseDto })
  @ApiResponse({ status: 201, description: 'Tạo hồ sơ báo lỗi chuyển khoản thành công' })
  createPaymentIssueCase(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreatePaymentIssueCaseDto,
  ) {
    return this.service.createPaymentIssueCase(req.user, dto);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Xem chi tiết hồ sơ hỗ trợ cùng lịch sử trao đổi và ngữ cảnh đối chiếu',
  })
  @ApiParam({ name: 'id', description: 'UUID của hồ sơ hỗ trợ' })
  @ApiResponse({ status: 200, description: 'Chi tiết hồ sơ hỗ trợ' })
  getCaseDetail(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.service.getCaseDetail(req.user, id);
  }

  @Get(':id/attachments')
  @ApiOperation({
    summary: 'Tải hoặc xem trước tệp biên lai / bằng chứng đính kèm trong hồ sơ hỗ trợ',
  })
  @ApiParam({ name: 'id', description: 'UUID của hồ sơ hỗ trợ' })
  async downloadAttachment(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query() query: DownloadSupportAttachmentQueryDto,
    @Res() res: Response,
  ) {
    const result = await this.service.downloadAttachment(
      req.user,
      id,
      query.key,
    );
    res.setHeader('Content-Type', result.mimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(result.fileName)}"`,
    );
    res.send(result.buffer);
  }

  @Post(':id/messages')
  @ApiOperation({
    summary: 'Gửi tin nhắn bổ sung hoặc phản hồi trong hồ sơ hỗ trợ',
  })
  @ApiParam({ name: 'id', description: 'UUID của hồ sơ hỗ trợ' })
  @ApiBody({ type: PostSupportMessageDto })
  @ApiResponse({ status: 201, description: 'Gửi tin nhắn thành công' })
  postMessage(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: PostSupportMessageDto,
  ) {
    return this.service.postMessage(req.user, id, dto);
  }

  @Patch(':id/status')
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Admin cập nhật trạng thái xử lý và chốt kết luận cho hồ sơ hỗ trợ',
  })
  @ApiParam({ name: 'id', description: 'UUID của hồ sơ hỗ trợ' })
  @ApiBody({ type: UpdateSupportCaseStatusDto })
  @ApiResponse({ status: 200, description: 'Cập nhật trạng thái thành công' })
  updateStatus(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateSupportCaseStatusDto,
  ) {
    return this.service.updateStatus(req.user, id, dto);
  }
}
