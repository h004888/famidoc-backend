import type { FacilitySettlement } from '@prisma/client';

export interface PackageSalesTotals {
  packagesSold: number;
  grossVnd: number;
  platformFeeVnd: number;
  facilityShareVnd: number;
}

export interface ParticipatingDoctorSummary {
  id: string;
  doctorName: string;
  specialty: string;
  isPrimary: boolean;
  encounterCount: number;
}

export interface FacilityFamilyPackageItem {
  invoiceId: string;
  invoiceCode: string;
  contractId: string;
  contractNumber: string;
  contractStatus: string;
  familyId: string;
  familyName: string;
  memberCount: number;
  packageCode: string;
  packageName: string;
  durationMonths: number;
  paidAt: string | null;
  startDate: string | null;
  endDate: string | null;
  purchasedInPeriod: boolean;
  primaryDoctor: { id: string; doctorName: string; specialty: string } | null;
  participatingDoctors: ParticipatingDoctorSummary[];
  packagePriceVnd: number;
  platformFeePercent: number;
  platformFeeVnd: number;
  facilitySharePercent: number;
  facilityShareVnd: number;
  periodRecognition?: {
    grossVnd: number;
    platformFeeVnd: number;
    facilityShareVnd: number;
    serviceFrom: string;
    serviceUntil: string;
  };
}

export interface FacilityBusinessSummary {
  activeHouseholds: number;
  doctors: { id: string; doctorName: string; specialty: string; households: number }[];
  familyPackages: FacilityFamilyPackageItem[];
  purchases: PackageSalesTotals & {
    purchasingHouseholds: number;
    byPackage: (PackageSalesTotals & { packageCode: string; packageName: string })[];
  };
}

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
  facilityBusiness?: FacilityBusinessSummary;
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
