import type {
  RevenueAnalyticsResult,
  MonthlySettlementResult,
} from '../../entities/finance.entity';
import type { AuthenticatedUser } from '../../../../core/auth/authenticated-request';
import type {
  MonthlySettlementDto,
  RevenueAnalyticsQueryDto,
} from '../../dtos/finance.dto';
export const FINANCE_SERVICE_TOKEN = Symbol('IFinanceService');
export interface IFinanceService {
  getRevenueAnalytics(
    actor: AuthenticatedUser,
    query: RevenueAnalyticsQueryDto,
  ): Promise<RevenueAnalyticsResult>;
  executeMonthlySettlement(
    actor: AuthenticatedUser,
    dto: MonthlySettlementDto,
  ): Promise<MonthlySettlementResult>;
}
