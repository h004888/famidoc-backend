import type { AuthenticatedUser } from '../../../../core/auth/authenticated-request';
import type { ProvisionDoctorDto } from '../../dtos/provision-doctor.dto';
import type { SubmitDoctorCredentialsDto } from '../../dtos/submit-credentials.dto';
import type {
  FacilityVerifyCredentialsDto,
  PlatformApproveCredentialsDto,
} from '../../dtos/verify-credentials.dto';
import type { DoctorResponseDto } from '../../dtos/doctor-response.dto';
import type { RegisterFacilityDto } from '../../dtos/register-facility.dto';
import type { ApproveFacilityAccountDto } from '../../dtos/approve-facility-account.dto';
import type { SubmitFacilityLegalProfileDto } from '../../dtos/submit-facility-legal-profile.dto';
import type { VerifyFacilityLegalDto } from '../../dtos/verify-facility-legal.dto';
import type { FacilityResponseDto } from '../../dtos/facility-response.dto';

export const DOCTORS_SERVICE_TOKEN = Symbol('IDoctorsService');

export interface IDoctorsService {
  // Facility Onboarding
  registerFacility(
    dto: RegisterFacilityDto,
    ip: string,
  ): Promise<FacilityResponseDto>;

  approveFacilityAccount(
    actor: AuthenticatedUser,
    facilityId: string,
    dto: ApproveFacilityAccountDto,
    ip: string,
  ): Promise<FacilityResponseDto>;

  submitFacilityLegalProfile(
    actor: AuthenticatedUser,
    dto: SubmitFacilityLegalProfileDto,
    ip: string,
  ): Promise<FacilityResponseDto>;

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

  submitDoctorCredentials(
    actor: AuthenticatedUser,
    doctorId: string,
    dto: SubmitDoctorCredentialsDto,
    ip: string,
  ): Promise<DoctorResponseDto>;

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
}
