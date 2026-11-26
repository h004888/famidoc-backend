import type {
  ContractSummary,
  ContractChangeTerms,
  ContractRenewalPreview,
  TerminationResult,
} from '../../entities/contract-change.entity';
import type { ContractAddendum, ContractSignature } from '@prisma/client';
import type { AuthenticatedUser } from '../../../../core/auth/authenticated-request';
import type {
  ConfirmContractRenewalDto,
  CreateContractAddendumDto,
  CreatePackageUpgradeDto,
  SignContractChangeDto,
  TerminateContractDto,
} from '../../dtos/contract-change.dto';
import type {
  CreateStaffingContractDto,
  UpdateStaffingContractDto,
  SignStaffingContractDto,
  RejectStaffingContractDto,
  RequestStaffingTerminationDto,
  TerminateStaffingContractDto,
  StaffingTerminationImpactDto,
  ListStaffingContractsDto,
  StaffingContractResponseDto,
} from '../../dtos/staffing-contract.dto';
import type { CreateMedicalContractDto } from '../../dtos/create-medical-contract.dto';
import type { AssignDoctorToPackageDto } from '../../dtos/assign-doctor.dto';
import type { ListMedicalContractsQueryDto } from '../../dtos/list-medical-contracts-query.dto';
import type { DetailedMedicalContract } from '../../repositories/interfaces/contracts.repository.interface';

/** Tùy chọn khi đọc chi tiết hợp đồng y tế. */
export interface FindMedicalContractOptions {
  /** Ép backend kiểm tra Documenso ngay, bỏ qua khoảng chờ giảm tần suất. */
  forceSync?: boolean;
}

export const CONTRACTS_SERVICE_TOKEN = Symbol('IContractsService');
export interface IContractsService {
  listMedicalContracts(
    actor: AuthenticatedUser,
    query: ListMedicalContractsQueryDto,
  ): Promise<{
    items: DetailedMedicalContract[];
    total: number;
    page: number;
    limit: number;
  }>;
  findMedicalContractById(
    actor: AuthenticatedUser,
    id: string,
    options?: FindMedicalContractOptions,
    ip?: string,
  ): Promise<DetailedMedicalContract>;
  getCareNeedsSummary(
    actor: AuthenticatedUser,
    id: string,
  ): Promise<any>;
  getContractDocument(
    actor: AuthenticatedUser,
    id: string,
  ): Promise<any>;
  initiateFourPartyContract(
    actor: AuthenticatedUser,
    dto: CreateMedicalContractDto,
  ): Promise<ContractSummary>;
  signFourPartyContract(
    actor: AuthenticatedUser,
    id: string,
    dto: SignContractChangeDto,
    ip: string,
  ): Promise<ContractSignature>;
  assignDoctorToPackage(
    actor: AuthenticatedUser,
    contractId: string,
    dto: AssignDoctorToPackageDto,
    ip: string,
  ): Promise<ContractSummary>;
  createInitialMedicalContract(
    actor: AuthenticatedUser,
    dto: CreateMedicalContractDto,
  ): Promise<ContractSummary>;
  previewFourPartyDraftPdf(
    actor: AuthenticatedUser,
    dto: CreateMedicalContractDto,
  ): Promise<Buffer>;
  rejectEscrowContract(
    actor: AuthenticatedUser,
    contractId: string,
    reason: string,
  ): Promise<any>;
  replaceDoctorWithCredit(
    actor: AuthenticatedUser,
    sourceContractId: string,
    doctorId: string,
  ): Promise<ContractSummary>;
  createRefundRequest(
    actor: AuthenticatedUser,
    contractId: string,
    payload: { bankName: string; accountNumber: string; accountHolder: string },
  ): Promise<any>;
  getRefundRequest(
    actor: AuthenticatedUser,
    contractId: string,
  ): Promise<any>;
  signInitialMedicalContract(
    actor: AuthenticatedUser,
    id: string,
    dto: SignContractChangeDto,
    ip: string,
  ): Promise<ContractSignature>;
  cancelDraftMedicalContract(
    actor: AuthenticatedUser,
    id: string,
    reason?: string,
  ): Promise<{ id: string; contractStatus: 'TERMINATED' | 'CANCELLED' }>;
  createStaffingContract(
    actor: AuthenticatedUser,
    dto: CreateStaffingContractDto,
    ip: string,
  ): Promise<StaffingContractResponseDto>;
  updateStaffingContract(
    actor: AuthenticatedUser,
    id: string,
    dto: UpdateStaffingContractDto,
    ip: string,
  ): Promise<StaffingContractResponseDto>;
  signStaffingContract(
    actor: AuthenticatedUser,
    id: string,
    dto: SignStaffingContractDto,
    ip: string,
  ): Promise<StaffingContractResponseDto>;
  requestStaffingRevision(
    actor: AuthenticatedUser,
    id: string,
    dto: RejectStaffingContractDto,
    ip: string,
  ): Promise<StaffingContractResponseDto>;
  rejectStaffingContract(
    actor: AuthenticatedUser,
    id: string,
    dto: RejectStaffingContractDto,
    ip: string,
  ): Promise<StaffingContractResponseDto>;
  getStaffingSigningSession(
    actor: AuthenticatedUser,
    id: string,
  ): Promise<{
    contractId: string;
    contractCode: string;
    status: string;
    signerRole: 'HEALTHCARE_FACILITY' | 'ADMIN';
    alreadySigned: boolean;
    canSign: boolean;
    waitingReason?: string;
    signingToken: string | null;
    signingUrl: string | null;
    facilitySigned: boolean;
    adminSigned: boolean;
    signedPdfUrl: string | null;
    documensoItemId?: string | null;
    hasDocumensoPdf?: boolean;
  }>;
  syncStaffingDocumensoEnvelope(
    actor: AuthenticatedUser,
    id: string,
    ip: string,
  ): Promise<{
    synced: boolean;
    contractId: string;
    status: string;
    facilitySigned: boolean;
    adminSigned: boolean;
    signedPdfUrl: string | null;
    documensoItemId?: string | null;
    hasDocumensoPdf?: boolean;
  }>;
  downloadStaffingSignedPdf(
    actor: AuthenticatedUser,
    id: string,
  ): Promise<{ buffer: Buffer; filename: string }>;
  getStaffingTerminationImpact(
    actor: AuthenticatedUser,
    id: string,
  ): Promise<StaffingTerminationImpactDto>;
  requestStaffingTermination(
    actor: AuthenticatedUser,
    id: string,
    dto: RequestStaffingTerminationDto,
    ip: string,
  ): Promise<StaffingContractResponseDto>;
  terminateStaffingContract(
    actor: AuthenticatedUser,
    id: string,
    dto: TerminateStaffingContractDto,
    ip: string,
  ): Promise<StaffingContractResponseDto>;
  listStaffingContracts(
    actor: AuthenticatedUser,
    query: ListStaffingContractsDto,
  ): Promise<{ items: StaffingContractResponseDto[]; total: number }>;
  getStaffingContract(
    actor: AuthenticatedUser,
    id: string,
  ): Promise<StaffingContractResponseDto>;
  createContractAddendum(
    actor: AuthenticatedUser,
    id: string,
    dto: CreateContractAddendumDto,
  ): Promise<ContractAddendum>;
  getRenewalPreview(
    actor: AuthenticatedUser,
    id: string,
  ): Promise<ContractRenewalPreview>;
  confirmContractRenewal(
    actor: AuthenticatedUser,
    id: string,
    dto: ConfirmContractRenewalDto,
    ip: string,
  ): Promise<ContractSummary>;
  createPackageUpgradeContract(
    actor: AuthenticatedUser,
    id: string,
    dto: CreatePackageUpgradeDto,
  ): Promise<ContractSummary>;
  terminateContract(
    actor: AuthenticatedUser,
    id: string,
    dto: TerminateContractDto,
  ): Promise<TerminationResult>;
  getContractChangeTerms(
    actor: AuthenticatedUser,
    id: string,
    addendumId?: string,
  ): Promise<ContractChangeTerms>;
  signContractAddendum(
    actor: AuthenticatedUser,
    id: string,
    addendumId: string,
    dto: SignContractChangeDto,
    ip: string,
  ): Promise<ContractSignature>;
  signUpgradedContract(
    actor: AuthenticatedUser,
    id: string,
    dto: SignContractChangeDto,
    ip: string,
  ): Promise<ContractSignature>;
  getSigningSession(
    actor: AuthenticatedUser,
    id: string,
  ): Promise<{
    contractId: string;
    contractNumber: string;
    contractStatus: string;
    signerRole: string;
    alreadySigned: boolean;
    canSign: boolean;
    signingToken: string | null;
    signingUrl: string | null;
    signedRoles: string[];
    signedPdfUrl: string | null;
    waitingReason?: string;
  }>;
  syncDocumensoEnvelope(
    actor: AuthenticatedUser,
    id: string,
    ip: string,
  ): Promise<{
    synced: boolean;
    contractId: string;
    contractStatus: string;
    signedRoles: string[];
    signedPdfUrl: string | null;
  }>;
  downloadSignedPdf(
    actor: AuthenticatedUser,
    id: string,
  ): Promise<{ buffer: Buffer; filename: string }>;
  getFamilyGateStatus(actor: AuthenticatedUser): Promise<{
    hasActiveContract: boolean;
    activeContract: {
      id: string;
      contractNumber: string;
      memberCount: number;
      endDate: Date;
    } | null;
    pendingContract: {
      id: string;
      contractNumber: string;
      contractStatus: string;
    } | null;
    patientCount: number;
  }>;
}
