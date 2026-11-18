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
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../../../core/auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../../../core/auth/roles.guard';
import type { AuthenticatedRequest } from '../../../core/auth/authenticated-request';
import {
  MonthlySettlementDto,
  ReviewSettlementDto,
  RevenueAnalyticsQueryDto,
  RunSePayReconciliationDto,
  SePayReconciliationQueryDto,
  SettlementEnvironmentDto,
} from '../dtos/finance.dto';
import {
  FINANCE_SERVICE_TOKEN,
  type IFinanceService,
} from '../services/interfaces/finance.service.interface';
import { SePayReconciliationService } from '../services/sepay-reconciliation.service';

@ApiTags('Finance')
@ApiBearerAuth('JWT-auth')
@Controller('api/v1/finance')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'HEALTHCARE_FACILITY')
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
export class FinanceController {
  constructor(
    @Inject(FINANCE_SERVICE_TOKEN) private readonly service: IFinanceService,
    private readonly sepayReconciliation: SePayReconciliationService,
  ) {}

  @Get('analytics')
  @ApiOperation({ summary: 'Báo cáo phân tích doanh thu và tỷ lệ phân chia' })
  @ApiResponse({ status: 200, description: 'Dữ liệu phân tích doanh thu' })
  @ApiResponse({
    status: 403,
    description: 'Chỉ ADMIN hoặc HEALTHCARE_FACILITY mới có quyền truy cập',
  })
  getRevenueAnalytics(
    @Req() req: AuthenticatedRequest,
    @Query() query: RevenueAnalyticsQueryDto,
  ) {
    return this.service.getRevenueAnalytics(req.user, query);
  }

  @Post('settlements/monthly')
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Thực thi quyết toán doanh thu định kỳ hàng tháng cho cơ sở y tế',
  })
  @ApiBody({ type: MonthlySettlementDto })
  @ApiResponse({ status: 201, description: 'Quyết toán doanh thu thành công' })
  @ApiResponse({ status: 403, description: 'Chỉ ADMIN mới có quyền thực hiện' })
  executeMonthlySettlement(
    @Req() req: AuthenticatedRequest,
    @Body() dto: MonthlySettlementDto,
  ) {
    return this.service.executeMonthlySettlement(req.user, dto);
  }

  @Patch('settlements/:id/review')
  @Roles('HEALTHCARE_FACILITY')
  @ApiOperation({ summary: 'CSYT xác nhận bảng quyết toán của mình hoặc báo sai lệch' })
  @ApiBody({ type: ReviewSettlementDto })
  reviewSettlement(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: ReviewSettlementDto,
  ) {
    return this.service.reviewSettlement(req.user, id, dto);
  }

  @Post('settlements/:id/evidence')
  @Roles('ADMIN')
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 0 },
  }))
  @ApiOperation({ summary: 'Tải chứng từ ngân hàng cho bảng quyết toán' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  uploadSettlementEvidence(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query() query: SettlementEnvironmentDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.service.uploadSettlementEvidence(req.user, id, query.environment, file);
  }

  @Post('reconciliation/sepay')
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Đối soát giao dịch với SePay API v2 và tự bù webhook bị bỏ lỡ',
  })
  @ApiBody({ type: RunSePayReconciliationDto })
  @ApiResponse({ status: 201, description: 'Hoàn thành một lượt đối soát' })
  runSePayReconciliation(
    @Req() req: AuthenticatedRequest,
    @Body() dto: RunSePayReconciliationDto,
  ) {
    return this.sepayReconciliation.runManual(req.user, dto);
  }

  @Get('reconciliation/sepay')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Xem lịch sử các lượt đối soát SePay' })
  listSePayReconciliations(@Query() query: SePayReconciliationQueryDto) {
    return this.sepayReconciliation.listRuns(query);
  }

  @Get('reconciliation/sepay/status')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Xem trạng thái và số giao dịch chưa đối soát' })
  getSePayReconciliationStatus(@Query() query: SePayReconciliationQueryDto) {
    return this.sepayReconciliation.getStatus(query.environment);
  }
}
