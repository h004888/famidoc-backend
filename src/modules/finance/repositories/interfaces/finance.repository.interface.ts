import { Prisma, type FacilitySettlement } from '@prisma/client';
export const FINANCE_INVOICE_INCLUDE = {
  contract: { include: { facility: true } },
  addendum: true,
  acceptedTransaction: true,
  settlementItem: true,
} as const;
export type RevenueInvoice = Prisma.InvoiceGetPayload<{
  include: typeof FINANCE_INVOICE_INCLUDE;
}>;
export interface RevenueFilter {
  start: Date;
  end: Date;
  environment: 'TEST' | 'LIVE';
  facilityId?: string;
  onlyUnsettled?: boolean;
}
export const FINANCE_REPOSITORY_TOKEN = Symbol('IFinanceRepository');
export interface FinanceSession {
  findFacilityForUser(userId: string): Promise<{ id: string } | null>;
  findEligibleInvoices(filter: RevenueFilter): Promise<RevenueInvoice[]>;
  countUnmatchedTransactions(filter: RevenueFilter): Promise<number>;
  findSettlements(
    filter: RevenueFilter,
    year: number,
    month: number,
  ): Promise<FacilitySettlement[]>;
  findSettlement(id: string): Promise<FacilitySettlement | null>;
  findPeriodSettlement(
    facilityId: string,
    year: number,
    month: number,
    environment: string,
  ): Promise<FacilitySettlement | null>;
  createSettlement(
    data: Prisma.FacilitySettlementUncheckedCreateInput,
  ): Promise<FacilitySettlement>;
  createSettlementItems(
    data: Prisma.FacilitySettlementItemCreateManyInput[],
  ): Promise<void>;
  updateSettlement(
    id: string,
    data: Prisma.FacilitySettlementUncheckedUpdateInput,
  ): Promise<FacilitySettlement>;
  recordFinanceEvent(
    actorId: string,
    settlement: FacilitySettlement,
    action: string,
  ): Promise<void>;
}
export interface IFinanceRepository {
  transaction<T>(work: (session: FinanceSession) => Promise<T>): Promise<T>;
}
