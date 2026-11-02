import {
  Prisma,
  type ContractAddendum,
  type ServicePackage,
  type ContractSignature,
  type B2bStaffingContract,
  type HealthcareFacility,
  type B2bContractStatus,
} from '@prisma/client';
import type {
  TerminationRequest,
  CreateTerminationRequest,
  UpdateTerminationRequest,
} from '../../entities/contract-change.entity';
export const CONTRACT_CHANGE_INCLUDE = {
  familyUnit: true,
  facility: true,
  doctor: { include: { user: true } },
  servicePackage: true,
} as const;
export type ChangeContract = Prisma.MedicalContractGetPayload<{
  include: typeof CONTRACT_CHANGE_INCLUDE;
}>;
export const CHANGE_ADDENDUM_INCLUDE = {
  signatures: true,
  contract: { include: CONTRACT_CHANGE_INCLUDE },
} as const;
export type ChangeAddendum = Prisma.ContractAddendumGetPayload<{
  include: typeof CHANGE_ADDENDUM_INCLUDE;
}>;
export const CONTRACTS_REPOSITORY_TOKEN = Symbol('IContractsRepository');
export interface ContractsSession {
  findContractForUpdate(id: string): Promise<ChangeContract | null>;
  findPackage(id: string): Promise<ServicePackage | null>;
  countFamilyMembers(familyId: string): Promise<number>;
  hasOtherActiveContract(familyId: string, exceptId: string): Promise<boolean>;
  findOpenUpgrade(sourceId: string): Promise<ChangeContract | null>;
  findAddendum(id: string): Promise<ChangeAddendum | null>;
  findAddendumByKey(key: string): Promise<ContractAddendum | null>;
  hasPendingMemberAddendum(contractId: string): Promise<boolean>;
  createAddendum(
    data: Prisma.ContractAddendumUncheckedCreateInput,
  ): Promise<ContractAddendum>;
  activateFreeAddendum(contractId: string, addendumId: string): Promise<void>;
  saveAddendumSignature(
    data: Prisma.ContractSignatureUncheckedCreateInput,
  ): Promise<ContractSignature>;
  createUpgrade(
    data: Prisma.MedicalContractUncheckedCreateInput,
  ): Promise<ChangeContract>;
  updateContractStatus(
    id: string,
    status: 'EXPIRED' | 'TERMINATED' | 'PENDING_PAYMENT',
    reason?: string,
  ): Promise<void>;
  refreshDoctorPanel(doctorId: string): Promise<void>;
  findPendingTermination(
    contractId: string,
  ): Promise<TerminationRequest | null>;
  findTermination(
    contractId: string,
    id: string,
  ): Promise<TerminationRequest | null>;
  createTermination(
    data: CreateTerminationRequest,
  ): Promise<TerminationRequest>;
  updateTermination(
    contractId: string,
    id: string,
    data: UpdateTerminationRequest,
  ): Promise<TerminationRequest>;
  hasEncounterInProgress(contractId: string): Promise<boolean>;
  cancelUnpaidRights(contractId: string): Promise<void>;
  findContractSignatures(contractId: string): Promise<ContractSignature[]>;
  saveUpgradeSignature(
    data: Prisma.ContractSignatureUncheckedCreateInput,
  ): Promise<ContractSignature>;
  recordChange(
    actorId: string,
    contract: ChangeContract,
    action: string,
    resourceId: string,
  ): Promise<void>;
  findFacilityById(id: string): Promise<HealthcareFacility | null>;
  findFacilityByUserId(userId: string): Promise<HealthcareFacility | null>;
  findConflictingStaffingContract(
    facilityId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<B2bStaffingContract | null>;
  createStaffingContract(
    data: Prisma.B2bStaffingContractUncheckedCreateInput,
  ): Promise<B2bStaffingContract & { facility: HealthcareFacility }>;
  findStaffingContract(
    id: string,
  ): Promise<(B2bStaffingContract & { facility: HealthcareFacility }) | null>;
  updateStaffingContractStatus(
    id: string,
    status: B2bContractStatus,
    signedPdfUrl?: string,
  ): Promise<B2bStaffingContract & { facility: HealthcareFacility }>;
  listStaffingContracts(
    where: Prisma.B2bStaffingContractWhereInput,
    skip: number,
    take: number,
  ): Promise<{
    items: (B2bStaffingContract & { facility: HealthcareFacility })[];
    total: number;
  }>;
  recordStaffingAudit(
    actorId: string,
    action: string,
    resourceId: string,
    ip: string,
  ): Promise<void>;
}
export interface IContractsRepository {
  transaction<T>(work: (session: ContractsSession) => Promise<T>): Promise<T>;
}
