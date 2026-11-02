import type { AuthenticatedUser } from '../../../../core/auth/authenticated-request';
import type { ProvisionDoctorDto } from '../../dtos/provision-doctor.dto';
import type { SubmitDoctorCredentialsDto } from '../../dtos/submit-credentials.dto';
import type {
  FacilityVerifyCredentialsDto,
  PlatformApproveCredentialsDto,
} from '../../dtos/verify-credentials.dto';
import type { DoctorResponseDto } from '../../dtos/doctor-response.dto';

export const DOCTORS_SERVICE_TOKEN = Symbol('IDoctorsService');

export interface IDoctorsService {
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
