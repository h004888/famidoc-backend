import { PortalOverviewResponseDto } from '../../dtos/portal-overview-response.dto';
import { SearchPublicPackagesDto } from '../../dtos/search-public-packages.dto';
import { PublicPackagesResponseDto } from '../../dtos/public-packages-response.dto';
import { PublicPackageDetailDto } from '../../dtos/public-package-detail.dto';
import { LookupHealthcareFacilitiesDto } from '../../dtos/lookup-facilities.dto';
import { PublicFacilitiesResponseDto } from '../../dtos/public-facilities-response.dto';
import { LookupDoctorDirectoryDto } from '../../dtos/lookup-doctors.dto';
import { PublicDoctorsResponseDto } from '../../dtos/public-doctors-response.dto';

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
}
