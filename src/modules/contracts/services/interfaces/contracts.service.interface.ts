import type {
  ContractSummary,
  ContractChangeTerms,
  TerminationResult,
} from '../../entities/contract-change.entity';
import type { ContractAddendum, ContractSignature } from '@prisma/client';
import type { AuthenticatedUser } from '../../../../core/auth/authenticated-request';
import type {
  CreateContractAddendumDto,
  CreatePackageUpgradeDto,
  SignContractChangeDto,
  TerminateContractDto,
} from '../../dtos/contract-change.dto';
import type {
  CreateStaffingContractDto,
  SignStaffingContractDto,
  ListStaffingContractsDto,
  StaffingContractResponseDto,
} from '../../dtos/staffing-contract.dto';
import type { CreateMedicalContractDto } from '../../dtos/create-medical-contract.dto';
import type { AssignDoctorToPackageDto } from '../../dtos/assign-doctor.dto';
import type { ListMedicalContractsQueryDto } from '../../dtos/list-medical-contracts-query.dto';
import type { DetailedMedicalContract } from '../../repositories/interfaces/contracts.repository.interface';
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
  signInitialMedicalContract(
    actor: AuthenticatedUser,
    id: string,
    dto: SignContractChangeDto,
    ip: string,
  ): Promise<ContractSignature>;
  createStaffingContract(
    actor: AuthenticatedUser,
    dto: CreateStaffingContractDto,
    ip: string,
  ): Promise<StaffingContractResponseDto>;
  signStaffingContract(
    actor: AuthenticatedUser,
    id: string,
    dto: SignStaffingContractDto,
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
}
