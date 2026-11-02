import { PortalOverviewResponseDto } from '../../dtos/portal-overview-response.dto';
import { SearchPublicPackagesDto } from '../../dtos/search-public-packages.dto';
import { PublicPackagesResponseDto } from '../../dtos/public-packages-response.dto';
import { PublicPackageDetailDto } from '../../dtos/public-package-detail.dto';

export const PUBLIC_SERVICE_TOKEN = Symbol('IPublicService');

export interface IPublicService {
  getPublicPortalOverview(): Promise<PortalOverviewResponseDto>;
  searchPublicPackages(
    dto: SearchPublicPackagesDto,
  ): Promise<PublicPackagesResponseDto>;
  getPublicPackageDetail(id: string): Promise<PublicPackageDetailDto>;
}
