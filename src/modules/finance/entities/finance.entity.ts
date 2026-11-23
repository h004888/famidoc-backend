import type { FacilitySettlement } from '@prisma/client';
export interface RevenueAnalyticsResult {
  settlementFrequency: 'MONTHLY';
  taxTreatment: string;
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
  unreconciledInvoiceCount?: number;
  settlements: FacilitySettlement[];
}
export interface PreparedSettlementResult {
  settlementFrequency: 'MONTHLY';
  year: number;
  month: number;
  environment: 'TEST' | 'LIVE';
  transferExecuted: false;
  message: string;
  settlements: FacilitySettlement[];
}
export type MonthlySettlementResult =
  FacilitySettlement | PreparedSettlementResult;
