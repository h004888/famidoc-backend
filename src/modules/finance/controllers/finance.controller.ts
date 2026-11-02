import {
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../core/auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../../../core/auth/roles.guard';
import type { AuthenticatedRequest } from '../../../core/auth/authenticated-request';
import {
  MonthlySettlementDto,
  RevenueAnalyticsQueryDto,
} from '../dtos/finance.dto';
import {
  FINANCE_SERVICE_TOKEN,
  type IFinanceService,
} from '../services/interfaces/finance.service.interface';

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
  ) {}

  @Get('analytics')
  @ApiOperation({ summary: 'Báo cáo phân tích doanh thu và tỷ lệ phân chia' })
  @ApiResponse({ status: 200, description: 'Dữ liệu phân tích doanh thu' })
  @ApiResponse({ status: 403, description: 'Chỉ ADMIN hoặc HEALTHCARE_FACILITY mới có quyền truy cập' })
  getRevenueAnalytics(
    @Req() req: AuthenticatedRequest,
    @Query() query: RevenueAnalyticsQueryDto,
  ) {
    return this.service.getRevenueAnalytics(req.user, query);
  }

  @Post('settlements/monthly')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Thực thi quyết toán doanh thu định kỳ hàng tháng cho cơ sở y tế' })
  @ApiBody({ type: MonthlySettlementDto })
  @ApiResponse({ status: 201, description: 'Quyết toán doanh thu thành công' })
  @ApiResponse({ status: 403, description: 'Chỉ ADMIN mới có quyền thực hiện' })
  executeMonthlySettlement(
    @Req() req: AuthenticatedRequest,
    @Body() dto: MonthlySettlementDto,
  ) {
    return this.service.executeMonthlySettlement(req.user, dto);
  }
}
