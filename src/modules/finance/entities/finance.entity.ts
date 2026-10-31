import type { FacilitySettlement } from '@prisma/client';
export interface RevenueAnalyticsResult {
  year: number;
  month: number;
  environment: 'TEST' | 'LIVE';
  facilityId: string | null;
  currency: 'VND';
  invoiceCount: number;
  grossVnd: number;
  vatVnd: number;
  netVnd: number;
  platformFeeVnd: number;
  facilityShareVnd: number;
  unmatchedTransactionsCount?: number;
  settlements: FacilitySettlement[];
}
export interface PreparedSettlementResult {
  year: number;
  month: number;
  environment: 'TEST' | 'LIVE';
  transferExecuted: false;
  message: string;
  settlements: FacilitySettlement[];
}
export type MonthlySettlementResult =
  FacilitySettlement | PreparedSettlementResult;
