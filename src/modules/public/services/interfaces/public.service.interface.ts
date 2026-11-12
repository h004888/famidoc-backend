import { PortalOverviewResponseDto } from '../../dtos/portal-overview-response.dto';
import { SearchPublicPackagesDto } from '../../dtos/search-public-packages.dto';
import { PublicPackagesResponseDto } from '../../dtos/public-packages-response.dto';
import { PublicPackageDetailDto } from '../../dtos/public-package-detail.dto';
import { LookupHealthcareFacilitiesDto } from '../../dtos/lookup-facilities.dto';
import { PublicFacilitiesResponseDto } from '../../dtos/public-facilities-response.dto';
import { LookupDoctorDirectoryDto } from '../../dtos/lookup-doctors.dto';
import {
  PublicDoctorsResponseDto,
  PublicDoctorItemDto,
} from '../../dtos/public-doctors-response.dto';
import { PublicDoctorDetailDto } from '../../dtos/public-doctor-detail.dto';
import {
  LookupDoctorReviewsQueryDto,
  PublicDoctorReviewsResponseDto,
} from '../../dtos/public-doctor-reviews.dto';
import { SubmitConsultationRequestDto } from '../../dtos/submit-consultation-request.dto';
import { ConsultationRequestResponseDto } from '../../dtos/consultation-request-response.dto';

export const PUBLIC_SERVICE_TOKEN = Symbol('IPublicService');

export interface IPublicService {
  getPublicPortalOverview(): Promise<PortalOverviewResponseDto>;
  searchPublicPackages(
    dto: SearchPublicPackagesDto,
  ): Promise<PublicPackagesResponseDto>;
  getPublicPackageDetail(id: string): Promise<PublicPackageDetailDto>;
  lookupHealthcareFacilities(
    dto: LookupHealthcareFacilitiesDto,
  ): Promise<PublicFacilitiesResponseDto>;
  lookupDoctorDirectory(
    dto: LookupDoctorDirectoryDto,
  ): Promise<PublicDoctorsResponseDto>;
  getPublicFacilityDetail(id: string): Promise<any>;
  getPublicDoctorDetail(id: string): Promise<PublicDoctorDetailDto>;
  getDoctorReviews(
    id: string,
    query: LookupDoctorReviewsQueryDto,
  ): Promise<PublicDoctorReviewsResponseDto>;
  submitConsultationRequest(
    dto: SubmitConsultationRequestDto,
    clientIp?: string,
    userAgent?: string,
  ): Promise<ConsultationRequestResponseDto>;
}
