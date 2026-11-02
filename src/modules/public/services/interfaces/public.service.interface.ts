import { PortalOverviewResponseDto } from '../../dtos/portal-overview-response.dto';
import { SearchPublicPackagesDto } from '../../dtos/search-public-packages.dto';
import { PublicPackagesResponseDto } from '../../dtos/public-packages-response.dto';

export const PUBLIC_SERVICE_TOKEN = Symbol('IPublicService');

export interface IPublicService {
  getPublicPortalOverview(): Promise<PortalOverviewResponseDto>;
  searchPublicPackages(
    dto: SearchPublicPackagesDto,
  ): Promise<PublicPackagesResponseDto>;
}
