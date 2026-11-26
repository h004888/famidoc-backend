import {
  Prisma,
  type ContractAddendum,
  type ContractDocumensoSigner,
  type SignerRole,
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
export type StaffingFacilityWithUser = HealthcareFacility & {
  user?: {
    id: string;
    email: string | null;
    fullName: string;
    phone: string | null;
  } | null;
};

export type StaffingContractWithFacility = B2bStaffingContract & {
  facility: StaffingFacilityWithUser;
};

export interface StaffingTerminationImpactCounts {
  activeMedicalContracts: number;
  pendingMedicalContracts: number;
  openEncounters: number;
  unsettledSettlements: number;
  unsettledPaidInvoices: number;
  activeOrOnboardingDoctors: number;
  openComplaints: number;
}
export const CONTRACT_CHANGE_INCLUDE = {
  familyUnit: true,
  facility: true,
  doctor: { include: { user: true } },
  servicePackage: true,
} as const;
export type ChangeContract = Prisma.MedicalContractGetPayload<{
  include: typeof CONTRACT_CHANGE_INCLUDE;
}>;
export const MEDICAL_CONTRACT_DETAIL_INCLUDE = {
  familyUnit: {
    include: {
      representativeUser: {
        select: {
          id: true,
          fullName: true,
          email: true,
          phone: true,
        },
      },
    },
  },
  facility: true,
  doctor: { include: { user: true } },
  servicePackage: true,
  members: {
    include: {
      patient: true,
    },
  },
  signatures: true,
  documensoSigners: {
    select: {
      signerRole: true,
      status: true,
      completedAt: true,
    },
  },
  // Lấy kèm phụ lục để admin chọn khoản cần thu ngay trên giao diện.
  addenda: {
    select: {
      id: true,
      addendumNumber: true,
      addendumType: true,
      additionalAmount: true,
      status: true,
      createdAt: true,
      signatures: {
        select: {
          signerRole: true,
          signedAt: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  },
  invoices: true,
  upgradedFrom: {
    select: {
      id: true,
      contractNumber: true,
      contractStatus: true,
      startDate: true,
      endDate: true,
    },
  },
  upgrades: {
    select: {
      id: true,
      contractNumber: true,
      contractStatus: true,
      startDate: true,
      endDate: true,
      holdExpiresAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  },
} as const;
export type DetailedMedicalContract = Prisma.MedicalContractGetPayload<{
  include: typeof MEDICAL_CONTRACT_DETAIL_INCLUDE;
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
  /** Transaction client của phiên hiện tại (dùng cho sổ cái ca khám). */
  getTx?(): Prisma.TransactionClient;
  findContractForUpdate(id: string): Promise<ChangeContract | null>;
  findPackage(id: string): Promise<ServicePackage | null>;
  countFamilyMembers(familyId: string): Promise<number>;
  hasOtherActiveContract(familyId: string, exceptId: string): Promise<boolean>;
  /** Khóa dòng gia đình rồi tìm hợp đồng đang mở (ACTIVE/PENDING_*) — luật 1 gia đình chỉ 1 gói. */
  findOpenContractForFamily?(
    familyId: string,
    exceptId?: string,
  ): Promise<{ id: string; contractStatus: string } | null>;
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
    status:
      | 'EXPIRED'
      | 'TERMINATED'
      | 'CANCELLED'
      | 'PENDING_PAYMENT'
      | 'PENDING_ACTIVATION'
      | 'ACTIVE',
    reason?: string,
    renewHold?: boolean,
  ): Promise<void>;
  getRenewalGraceDays?(): Promise<number>;
  findActivePackageByLineage?(lineageCode: string): Promise<ServicePackage | null>;
  findActivePatientsByFamilyId?(familyId: string): Promise<
    Array<{
      id: string;
      fullName: string;
      dateOfBirth: Date;
      gender: string;
      relationshipToRep: string;
    }>
  >;
  findChildRenewalsBySourceId?(sourceId: string): Promise<ChangeContract[]>;
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
  hasPaidInvoice(contractId: string): Promise<boolean>;
  cancelPendingInvoices(contractId: string): Promise<void>;
  findContractSignatures(contractId: string): Promise<ContractSignature[]>;
  saveUpgradeSignature(
    data: Prisma.ContractSignatureUncheckedCreateInput,
  ): Promise<ContractSignature>;
  saveSignature?(
    data: Prisma.ContractSignatureUncheckedCreateInput,
    signingDeadlineAt?: Date | null,
  ): Promise<ContractSignature>;
  recordChange(
    actorId: string,
    contract: ChangeContract,
    action: string,
    resourceId: string,
  ): Promise<void>;
  findFacilityById(id: string): Promise<HealthcareFacility | null>;
  findFacilityById(id: string): Promise<StaffingFacilityWithUser | null>;
  findFacilityByUserId(userId: string): Promise<StaffingFacilityWithUser | null>;
  findDoctorById(id: string): Promise<any | null>;
  lockDoctorAndCountActiveAndHeld?(
    doctorId: string,
    exceptContractId?: string,
  ): Promise<{
    doctor: any;
    activeAndHeldCount: number;
  } | null>;
  findMatchingSessionById?(id: string): Promise<any | null>;
  markMatchingSessionConfirmed?(id: string, contractId: string): Promise<void>;
  findMatchingQueueRequestById?(id: string): Promise<any | null>;
  markMatchingQueueConfirmed?(id: string, contractId: string): Promise<void>;
  findDoctorByUserId(userId: string): Promise<any | null>;
  findFamilyById(id: string): Promise<any | null>;
  findFamilyByRepresentativeUserId(userId: string): Promise<any | null>;
  updateFamilyHomeAddress?(familyId: string, homeAddress: string): Promise<void>;
  findPatientsByIdsAndFamilyId(
    patientIds: string[],
    familyId: string,
  ): Promise<Array<{ id: string }>>;
  createMedicalContract(
    data: Prisma.MedicalContractUncheckedCreateInput,
  ): Promise<ChangeContract>;
  createContractMembers(
    contractId: string,
    patientIds: string[],
  ): Promise<void>;
  updateContractDoctor(id: string, doctorId: string): Promise<ChangeContract>;
  listMedicalContracts(
    where: Prisma.MedicalContractWhereInput,
    skip: number,
    take: number,
  ): Promise<{
    items: DetailedMedicalContract[];
    total: number;
  }>;
  findMedicalContractById(id: string): Promise<DetailedMedicalContract | null>;
  findPatientsWithClinicalProfile?(
    patientIds: string[],
  ): Promise<any[]>;
  /**
   * Hợp đồng cung ứng nhân lực B2B đang ACTIVE và còn hiệu lực tại `atDate`
   * (`startDate <= atDate < endDate`) của một cơ sở y tế.
   */
  findActiveStaffingContract(
    facilityId: string,
    atDate: Date,
  ): Promise<B2bStaffingContract | null>;
  findConflictingStaffingContract(
    facilityId: string,
    startDate: Date,
    endDate: Date,
    excludeContractId?: string,
  ): Promise<B2bStaffingContract | null>;
  createStaffingContract(
    data: Prisma.B2bStaffingContractUncheckedCreateInput,
  ): Promise<StaffingContractWithFacility>;
  findStaffingContract(
    id: string,
  ): Promise<StaffingContractWithFacility | null>;
  lockStaffingContractForUpdate?(
    id: string,
  ): Promise<StaffingContractWithFacility | null>;
  updateStaffingContract?(
    id: string,
    data: Prisma.B2bStaffingContractUncheckedUpdateInput,
  ): Promise<StaffingContractWithFacility>;
  updateStaffingContractStatus(
    id: string,
    status: B2bContractStatus,
    signedPdfUrl?: string,
  ): Promise<StaffingContractWithFacility>;
  getStaffingTerminationImpact?(
    facilityId: string,
  ): Promise<StaffingTerminationImpactCounts>;
  listStaffingContracts(
    where: Prisma.B2bStaffingContractWhereInput,
    skip: number,
    take: number,
  ): Promise<{
    items: StaffingContractWithFacility[];
    total: number;
  }>;
  recordStaffingAudit(
    actorId: string,
    action: string,
    resourceId: string,
    ip: string,
  ): Promise<void>;
  findFirstActiveAdminUser?(): Promise<{
    id: string;
    email: string;
    fullName: string;
  } | null>;
  saveDocumensoSigners?(
    signers: Array<{
      contractId: string;
      signerRole: SignerRole;
      documensoRecipientId: number;
      documensoToken: string;
      documensoSigningUrl: string;
      status: string;
      completedAt?: Date | null;
    }>,
  ): Promise<void>;
  findDocumensoSigners?(contractId: string): Promise<ContractDocumensoSigner[]>;
  updateContractDocumensoEnvelope?(
    contractId: string,
    documensoEnvelopeId: string,
    documensoItemId: string,
  ): Promise<boolean | void>;
  clearLegacyNonDocumensoSignatures?(contractId: string): Promise<void>;
  clearDocumensoState?(contractId: string): Promise<void>;
  findFamilyGateStatus?(familyId: string): Promise<{
    activeContract: {
      id: string;
      contractNumber: string;
      memberCount: number;
      endDate: Date;
      packageName?: string | null;
      packageDescription?: string | null;
      doctor?: {
        id: string;
        fullName: string;
        title: string;
        hospitalName: string;
        avatarUrl: string | null;
        phone: string | null;
        experienceYears: number;
      } | null;
    } | null;
    pendingContract: {
      id: string;
      contractNumber: string;
      contractStatus: string;
    } | null;
    familyUnit?: {
      id: string;
      homeAddress: string;
      emergencyPhone: string;
      representativeName: string;
    } | null;
    patientCount: number;
    hasHistoricalContracts?: boolean;
  }>;
  findAdminUsers(): Promise<{ id: string }[]>;
  createNotification(data: {
    userId: string;
    title: string;
    content: string;
    type: string;
  }): Promise<void>;
}
export interface IContractsRepository {
  transaction<T>(work: (session: ContractsSession) => Promise<T>): Promise<T>;
}
