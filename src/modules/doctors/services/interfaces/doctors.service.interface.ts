import type { AuthenticatedUser } from '../../../../core/auth/authenticated-request';
import type { ProvisionDoctorDto } from '../../dtos/provision-doctor.dto';
import type { SubmitDoctorCredentialsDto } from '../../dtos/submit-credentials.dto';
import type {
  FacilityVerifyCredentialsDto,
  PlatformApproveCredentialsDto,
} from '../../dtos/verify-credentials.dto';
import type { DoctorResponseDto } from '../../dtos/doctor-response.dto';
import type { CreateFacilityDto } from '../../dtos/create-facility.dto';
import type { SubmitFacilityLegalProfileDto } from '../../dtos/submit-facility-legal-profile.dto';
import type { VerifyFacilityLegalDto } from '../../dtos/verify-facility-legal.dto';
import type { FacilityResponseDto } from '../../dtos/facility-response.dto';
import type { ListDoctorsQueryDto } from '../../dtos/list-doctors-query.dto';
import type {
  BulkImportDoctorsPreviewResponseDto,
  ConfirmBulkImportDoctorsDto,
  ConfirmBulkImportDoctorsResponseDto,
} from '../../dtos/bulk-import-doctors.dto';

export interface UploadedFacilityLegalFiles {
  operatingLicenseFile?: Express.Multer.File[];
  file?: Express.Multer.File[];
  businessLicenseFile?: Express.Multer.File[];
}

export type FacilityLegalDocumentType = 'operating' | 'business';

export interface UploadedDoctorCredentialFiles {
  cchnFile?: Express.Multer.File[];
  practiceLicenseFile?: Express.Multer.File[];
  degreeFile?: Express.Multer.File[];
  familyMedicineFile?: Express.Multer.File[];
  familyMedicineCertFile?: Express.Multer.File[];
  files?: Express.Multer.File[];
}

export const DOCTORS_SERVICE_TOKEN = Symbol('IDoctorsService');

export interface IDoctorsService {
  // Facility Onboarding
  createFacilityByAdmin(
    actor: AuthenticatedUser,
    dto: CreateFacilityDto,
    ip: string,
  ): Promise<FacilityResponseDto>;

  submitFacilityLegalProfile(
    actor: AuthenticatedUser,
    dto: SubmitFacilityLegalProfileDto,
    ip: string,
    files?: Express.Multer.File | UploadedFacilityLegalFiles,
  ): Promise<FacilityResponseDto>;

  getFacilityLegalDocument(
    facilityId: string,
    actor?: AuthenticatedUser,
    docType?: FacilityLegalDocumentType,
  ): Promise<{ bytes: Buffer; contentType: string }>;

  verifyFacilityLegal(
    actor: AuthenticatedUser,
    facilityId: string,
    dto: VerifyFacilityLegalDto,
    ip: string,
  ): Promise<FacilityResponseDto>;

  getMyFacility(actor: AuthenticatedUser): Promise<FacilityResponseDto>;

  listFacilitiesForAdmin(
    actor: AuthenticatedUser,
    query?: { status?: string; page?: number; limit?: number },
  ): Promise<{ items: FacilityResponseDto[]; total: number }>;

  getFacilityDetailForAdmin(
    actor: AuthenticatedUser,
    facilityId: string,
  ): Promise<FacilityResponseDto>;

  // Doctor Provisioning & Onboarding
  provisionDoctorAccount(
    actor: AuthenticatedUser,
    dto: ProvisionDoctorDto,
    ip: string,
  ): Promise<DoctorResponseDto>;

  generateDoctorImportTemplate(actor: AuthenticatedUser): Promise<Buffer>;

  previewDoctorsExcelImport(
    actor: AuthenticatedUser,
    file?: Express.Multer.File,
  ): Promise<BulkImportDoctorsPreviewResponseDto>;

  confirmDoctorsBulkImport(
    actor: AuthenticatedUser,
    dto: ConfirmBulkImportDoctorsDto,
    ip: string,
  ): Promise<ConfirmBulkImportDoctorsResponseDto>;

  submitDoctorCredentials(
    actor: AuthenticatedUser,
    doctorId: string,
    dto: SubmitDoctorCredentialsDto,
    ip: string,
    uploadedFiles?: UploadedDoctorCredentialFiles,
  ): Promise<DoctorResponseDto>;

  getDoctorCredentialFile(
    actor: AuthenticatedUser,
    doctorId: string,
    credentialId: string,
  ): Promise<{ bytes: Buffer; contentType: string }>;

  approveDoctorCredentialsByFacility(
    actor: AuthenticatedUser,
    doctorId: string,
    dto: FacilityVerifyCredentialsDto,
    ip: string,
  ): Promise<DoctorResponseDto>;

  approveDoctorCredentialsByPlatform(
    actor: AuthenticatedUser,
    doctorId: string,
    dto: PlatformApproveCredentialsDto,
    ip: string,
  ): Promise<DoctorResponseDto>;

  getDoctorProfile(
    actor: AuthenticatedUser,
    doctorId: string,
  ): Promise<DoctorResponseDto>;

  listDoctors(
    actor: AuthenticatedUser,
    query: ListDoctorsQueryDto,
  ): Promise<{
    items: DoctorResponseDto[];
    total: number;
    page: number;
    limit: number;
  }>;

  listFacilityDoctors(
    actor: AuthenticatedUser,
    query: ListDoctorsQueryDto,
  ): Promise<{
    items: DoctorResponseDto[];
    total: number;
    page: number;
    limit: number;
  }>;
}
