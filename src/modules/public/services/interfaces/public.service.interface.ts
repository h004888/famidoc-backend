import { PortalOverviewResponseDto } from '../../dtos/portal-overview-response.dto';

export const PUBLIC_SERVICE_TOKEN = Symbol('IPublicService');

export interface IPublicService {
  getPublicPortalOverview(): Promise<PortalOverviewResponseDto>;
}
