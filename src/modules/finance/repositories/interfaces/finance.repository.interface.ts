import { Prisma, type FacilitySettlement } from '@prisma/client';
export const FINANCE_INVOICE_INCLUDE = {
  contract: { include: { facility: true } },
  addendum: true,
  acceptedTransaction: true,
  settlementItems: true,
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
export interface FacilityPackageInvoiceInput {
  id?: string;
  invoiceCode?: string;
  paidAt?: Date | null;
  totalPayable: Prisma.Decimal;
  addendumId?: string | null;
  settlementItems?: {
    recognitionYear: number | null;
    recognitionMonth: number | null;
    recognitionBasis: string;
    grossAmount: unknown;
    vatAmount: unknown;
    netAmount: unknown;
    platformFeeAmount: unknown;
    facilityShareAmount: unknown;
    serviceFrom: Date | null;
    serviceUntil: Date | null;
  }[];
  contract: {
    id?: string;
    contractNumber?: string;
    contractStatus?: string;
    startDate?: Date;
    endDate?: Date;
    terminatedAt?: Date | null;
    memberCount?: number;
    familyId: string;
    familyUnit?: {
      representativeUser?: { fullName: string } | null;
    } | null;
    doctor?: { id: string; doctorName: string; specialty: string } | null;
    servicePackage: {
      lineageCode: string;
      packageName: string;
      durationMonths?: number;
    };
    encounters?: {
      doctor: { id: string; doctorName: string; specialty: string };
    }[];
  } | null;
}
export interface FacilityBusinessInputs {
  doctors: { id: string; doctorName: string; specialty: string }[];
  activeContracts: { familyId: string; doctorId: string | null }[];
  paidInvoices: FacilityPackageInvoiceInput[];
  packageInvoices?: FacilityPackageInvoiceInput[];
}
export const FINANCE_REPOSITORY_TOKEN = Symbol('IFinanceRepository');
export interface FinanceSession {
  getSatisfactionSummary(
    filter: RevenueFilter,
  ): Promise<{
    reviewCount: number;
    averageStars: number | null;
    affectsPayout: false;
    byDoctor: {
      doctorId: string;
      averageStars: number | null;
      reviewCount: number;
    }[];
  }>;
  getSatisfactionSummary(
    filter: RevenueFilter,
  ): Promise<{
    reviewCount: number;
    averageStars: number | null;
    affectsPayout: false;
    byDoctor: {
      doctorId: string;
      averageStars: number | null;
      reviewCount: number;
    }[];
  }>;
  findFacilityForUser(userId: string): Promise<{ id: string } | null>;
  getFacilityBusinessInputs(
    filter: RevenueFilter & { facilityId: string },
  ): Promise<FacilityBusinessInputs>;
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
