import type { MedicalContractStatus, Prisma, SignerRole } from '@prisma/client';
export interface ContractSummary {
  id: string;
  contractNumber: string;
  familyId: string;
  facilityId: string;
  doctorId: string;
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
