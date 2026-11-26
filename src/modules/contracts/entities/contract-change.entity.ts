import type { MedicalContractStatus, Prisma, SignerRole } from '@prisma/client';
export interface ContractSummary {
  id: string;
  contractNumber: string;
  familyId: string;
  facilityId: string;
  doctorId: string | null;
  packageId: string;
  totalAmount: number;
  remainingHomeVisits: number;
  remainingTelehealth: number;
  startDate: Date;
  endDate: Date;
  contractStatus: MedicalContractStatus;
  upgradedFromId: string | null;
  memberCount: number;
  isDemo: boolean;
  documensoEnvelopeId?: string | null;
  documensoItemId?: string | null;
  signingToken?: string | null;
  signingUrl?: string | null;
  additionalTerms?: string | null;
  holdExpiresAt?: Date | null;
}

export type RenewalCaseType = 'CASE_A' | 'CASE_B';

export interface RenewalBlockingItem {
  code:
    | 'CONTRACT_TERMINATED'
    | 'CONTRACT_NOT_ACTIVE_YET'
    | 'GRACE_PERIOD_EXPIRED'
    | 'RENEWAL_ALREADY_EXISTS'
    | 'PACKAGE_UNAVAILABLE'
    | 'DOCTOR_INACTIVE'
    | 'DOCTOR_PANEL_FULL'
    | 'PENDING_TERMINATION_REQUEST'
    | 'PENDING_MEMBER_ADDENDUM'
    | 'NO_ACTIVE_MEMBERS';
  message: string;
}

export interface ContractRenewalPreview {
  sourceContractId: string;
  sourceContractNumber: string;
  sourceStatus: MedicalContractStatus;
  eligible: boolean;
  suggestBuyNew: boolean;
  caseType: RenewalCaseType | null;
  graceDays: number;
  graceEndsAt: string | null;
  expectedStartDate: string | null;
  expectedEndDate: string | null;
  paymentDeadlineAt: string | null;
  blockingReasons: RenewalBlockingItem[];
  existingRenewal: {
    id: string;
    contractNumber: string;
    contractStatus: MedicalContractStatus;
  } | null;
  package: {
    id: string;
    code: string;
    name: string;
    durationMonths: number;
    quotas: {
      homeVisits: number;
      videoConsultations: number;
    };
  } | null;
  doctor: {
    id: string;
    fullName: string;
  } | null;
  facility: {
    id: string;
    name: string;
  } | null;
  members: Array<{
    id: string;
    fullName: string;
    relationshipToRep: string;
  }>;
  pricing: {
    basePriceVnd: number;
    additionalMembersTotalVnd: number;
    totalPriceVnd: number;
    currency: string;
  } | null;
  termsHash: string | null;
}
export interface ContractChangeTerms {
  id: string;
  termsHash: string;
  terms: Prisma.JsonValue | null;
  status: string;
  signedRoles: SignerRole[];
  amountVnd?: number;
  startDate?: Date;
  endDate?: Date;
  memberCount?: number;
}
// Đây là dữ liệu nằm trong medical_contracts.termination_requests, không phải bảng riêng.
export interface TerminationRequest {
  id: string;
  contractId: string;
  requestedByUserId: string;
  reason: string;
  termsHash: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  consents: Prisma.JsonValue;
  decisionNotes: string | null;
  decidedByUserId: string | null;
  decidedAt: string | null;
  createdAt: string;
}
export type CreateTerminationRequest = Pick<
  TerminationRequest,
  'contractId' | 'requestedByUserId' | 'reason' | 'termsHash' | 'consents'
>;
export type UpdateTerminationRequest = Partial<
  Pick<
    TerminationRequest,
    'status' | 'decisionNotes' | 'decidedByUserId' | 'decidedAt' | 'consents'
  >
>;
export type TerminationResult = TerminationRequest & {
  contractStatus?: 'TERMINATED';
  refundProcessed?: false;
};
