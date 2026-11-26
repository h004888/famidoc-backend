import type { CarePackageQuote } from '../../entities/care-package-quote.entity';
import type { CarePackage } from '../../entities/care-package.entity';
import type { CarePackagesPage } from '../../repositories/interfaces/care-packages.repository.interface';
import type { CreateCarePackageDto } from '../../dtos/create-care-package.dto';
import type {
  AdminListCarePackagesDto,
  ListCarePackagesDto,
} from '../../dtos/list-care-packages.dto';
import type { QuoteCarePackageDto } from '../../dtos/quote-care-package.dto';
import type { UpdateCarePackageDto } from '../../dtos/update-care-package.dto';
import type { ValidateCarePackageDto } from '../../dtos/create-care-package.dto';
import type {
  CarePackageActionContext,
  CarePackageValidationResult,
} from '../impl/care-packages.service.impl';

export const CARE_PACKAGES_SERVICE_TOKEN = Symbol('ICarePackagesService');
export interface ICarePackagesService {
  listPublic(query: ListCarePackagesDto): Promise<CarePackagesPage>;
  listAdmin(query: AdminListCarePackagesDto): Promise<CarePackagesPage>;
  getPublic(id: string): Promise<CarePackage>;
  getAdmin(id: string): Promise<CarePackage>;
  quote(id: string, dto: QuoteCarePackageDto): Promise<CarePackageQuote>;
  validate(dto: ValidateCarePackageDto): Promise<CarePackageValidationResult>;
  create(
    dto: CreateCarePackageDto & { acknowledgedWarnings?: string[] },
    ctx?: CarePackageActionContext,
  ): Promise<CarePackage>;
  update(
    id: string,
    dto: UpdateCarePackageDto & { acknowledgedWarnings?: string[] },
    ctx?: CarePackageActionContext,
  ): Promise<CarePackage>;
  createVersion(id: string): Promise<CarePackage>;
  publish(id: string, ctx?: CarePackageActionContext): Promise<CarePackage>;
  reopen(id: string, ctx?: CarePackageActionContext): Promise<CarePackage>;
  retire(id: string): Promise<CarePackage>;
}
