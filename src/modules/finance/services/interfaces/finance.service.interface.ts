import type {
  RevenueAnalyticsResult,
  MonthlySettlementResult,
} from '../../entities/finance.entity';
import type { AuthenticatedUser } from '../../../../core/auth/authenticated-request';
import type {
  MonthlySettlementDto,
  ReviewSettlementDto,
  RevenueAnalyticsQueryDto,
  SettlementEnvironmentDto,
} from '../../dtos/finance.dto';
import type { FacilitySettlement } from '@prisma/client';
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
  reviewSettlement(
    actor: AuthenticatedUser,
    id: string,
    dto: ReviewSettlementDto,
  ): Promise<FacilitySettlement>;
  uploadSettlementEvidence(
    actor: AuthenticatedUser,
    id: string,
    environment: SettlementEnvironmentDto['environment'],
    file?: Express.Multer.File,
  ): Promise<{ evidenceKey: string }>;
}
