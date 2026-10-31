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
  @Get('analytics') getRevenueAnalytics(
    @Req() req: AuthenticatedRequest,
    @Query() query: RevenueAnalyticsQueryDto,
  ) {
    return this.service.getRevenueAnalytics(req.user, query);
  }
  @Post('settlements/monthly') @Roles('ADMIN') executeMonthlySettlement(
    @Req() req: AuthenticatedRequest,
    @Body() dto: MonthlySettlementDto,
  ) {
    return this.service.executeMonthlySettlement(req.user, dto);
  }
}
