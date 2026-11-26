import {
  BadRequestException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  BaseApiException,
  BusinessConflictException,
  ResourceNotFoundException,
} from '../../../../core/exceptions/api.exception';
import { CarePackageErrorCode } from '../../../../core/constants/error-codes.constant';
import type { CreateCarePackageDto, ValidateCarePackageDto } from '../../dtos/create-care-package.dto';
import type {
  AdminListCarePackagesDto,
  ListCarePackagesDto,
} from '../../dtos/list-care-packages.dto';
import type { UpdateCarePackageDto } from '../../dtos/update-care-package.dto';
import {
  CarePackageStatus,
  QuotaPeriod,
  type CarePackage,
  type CarePackageTerms,
} from '../../entities/care-package.entity';
import {
  CARE_PACKAGES_REPOSITORY_TOKEN,
  type CarePackagesRepository,
} from '../../repositories/interfaces/care-packages.repository.interface';
import { validateCarePackageTerms } from '../../validate-care-package-terms';
import type { QuoteCarePackageDto } from '../../dtos/quote-care-package.dto';
import type { CarePackageQuote } from '../../entities/care-package-quote.entity';
import { calculateCarePackageQuote } from '../../pricing/calculate-care-package-quote';
import {
  assertNoBlockingFindings,
  evaluateCarePackageLoad,
  evaluateCarePackageRules,
  type CarePackageLoad,
  type CarePackageRuleFinding,
} from '../../rules/care-package-rules';

export interface CarePackageValidationResult {
  ok: boolean;
  requiresAcknowledgement: string[];
  findings: CarePackageRuleFinding[];
  load: CarePackageLoad;
  maxContractVideoConsultations: number | null;
}

@Injectable()
export class CarePackagesServiceImpl {
  constructor(
    @Inject(CARE_PACKAGES_REPOSITORY_TOKEN)
    private readonly repository: CarePackagesRepository,
  ) {}

  listPublic(query: ListCarePackagesDto) {
    return this.repository.list(
      query.page,
      query.limit,
      CarePackageStatus.ACTIVE,
    );
  }

  listAdmin(query: AdminListCarePackagesDto) {
    return this.repository.list(query.page, query.limit, query.status, {
      excludeDemo: true,
      excludeDrafts: query.excludeDrafts,
      ascendingPrice: true,
    });
  }

  async getPublic(id: string): Promise<CarePackage> {
    const item = await this.getAdmin(id);
    if (item.status !== CarePackageStatus.ACTIVE) {
      throw new ResourceNotFoundException(
        CarePackageErrorCode.CARE_PACKAGE_NOT_FOUND,
        'Không tìm thấy gói dịch vụ.',
      );
    }
    return item;
  }

  async quote(id: string, dto: QuoteCarePackageDto): Promise<CarePackageQuote> {
    const carePackage = await this.getPublic(id);
    if (dto.memberCount > carePackage.maxMembers) {
      const candidates = await this.repository.list(
        1,
        100,
        CarePackageStatus.ACTIVE,
      );
      throw new BadRequestException({
        message: 'Số người vượt trần gói đang chọn.',
        code: 'PACKAGE_MEMBER_LIMIT',
        maxMembers: carePackage.maxMembers,
        requestedMembers: dto.memberCount,
        suggestHigherPackage: true,
        suggestedPackages: candidates.items
          .filter((p) => p.maxMembers >= dto.memberCount && p.id !== id)
          .sort((a, b) => a.durationMonths - b.durationMonths)
          .map((p) => ({
            id: p.id,
            name: p.name,
            durationMonths: p.durationMonths,
            maxMembers: p.maxMembers,
            priceVnd: p.priceVnd,
          })),
      });
    }
    return calculateCarePackageQuote(carePackage, dto.memberCount, dto);
  }

  async getAdmin(id: string): Promise<CarePackage> {
    const item = await this.repository.findById(id);
    if (!item) {
      throw new ResourceNotFoundException(
        CarePackageErrorCode.CARE_PACKAGE_NOT_FOUND,
        'Không tìm thấy gói dịch vụ.',
      );
    }
    return item;
  }

  async validate(dto: ValidateCarePackageDto): Promise<CarePackageValidationResult> {
    const { packageId: _packageId, ...rawTerms } = dto;
    const terms: CarePackageTerms = {
      ...rawTerms,
      quotaPeriod: QuotaPeriod.PER_TERM,
      videoQuotaPolicy: 'FIXED',
    };
    return this.evaluate(terms, true);
  }

  private async evaluate(
    terms: CarePackageTerms,
    runDryRun: boolean,
  ): Promise<CarePackageValidationResult> {
    const findings = evaluateCarePackageRules(terms, { runDryRun });
    return {
      ok: findings.every((f) => f.level !== 'BLOCK'),
      requiresAcknowledgement: [],
      findings,
      load: evaluateCarePackageLoad(terms),
      maxContractVideoConsultations: null,
    };
  }

  private async enforceRules(
    terms: CarePackageTerms,
    runDryRun: boolean,
  ): Promise<void> {
    const result = await this.evaluate(terms, runDryRun);
    assertNoBlockingFindings(result.findings);
  }

  private generateCandidateCode(): string {
    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const randPart = randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase();
    return `PKG_${datePart}_${randPart}`;
  }

  private async generateUniqueCode(): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = this.generateCandidateCode();
      const existing = await this.repository.findLatestByCode(candidate);
      if (!existing) return candidate;
    }
    throw new BusinessConflictException(
      CarePackageErrorCode.CARE_PACKAGE_CODE_EXISTS,
      'Không thể tạo mã gói duy nhất. Vui lòng thử lại.',
    );
  }

  async create(dto: CreateCarePackageDto): Promise<CarePackage> {
    const terms: CarePackageTerms = {
      ...dto,
      quotaPeriod: QuotaPeriod.PER_TERM,
      videoQuotaPolicy: 'FIXED',
    };
    validateCarePackageTerms(terms);
    await this.enforceRules(terms, true);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = await this.generateUniqueCode();
      try {
        return await this.insertPackage(code, 1, terms, CarePackageStatus.ACTIVE);
      } catch (err) {
        if (attempt === 4) throw err;
      }
    }
    throw new BusinessConflictException(
      CarePackageErrorCode.CARE_PACKAGE_CODE_EXISTS,
      'Mã gói được sinh ra bị trùng trong hệ thống. Vui lòng thử lại.',
    );
  }

  async update(
    id: string,
    dto: UpdateCarePackageDto,
  ): Promise<CarePackage> {
    const current = await this.getAdmin(id);
    if (current.status === CarePackageStatus.DEPRECATED) {
      throw new BusinessConflictException(
        CarePackageErrorCode.CARE_PACKAGE_DEPRECATED_READONLY,
        'Không thể chỉnh sửa gói dịch vụ đã ngừng bán.',
      );
    }
    const changes = Object.fromEntries(
      Object.entries(dto).filter(([, value]) => value !== undefined),
    ) as Partial<CarePackageTerms>;
    if (Object.keys(changes).length === 0) {
      throw new BaseApiException({
        errorCode: CarePackageErrorCode.CARE_PACKAGE_TERMS_INVALID,
        status: HttpStatus.BAD_REQUEST,
        message: 'Vui lòng cung cấp ít nhất một trường cần cập nhật.',
      });
    }
    const merged: CarePackageTerms = {
      ...current,
      ...changes,
      quotaPeriod: QuotaPeriod.PER_TERM,
      videoQuotaPolicy: 'FIXED',
    };
    validateCarePackageTerms(merged);
    await this.enforceRules(merged, current.status === CarePackageStatus.ACTIVE);
    return this.repository.updateDraft(id, {
      ...changes,
      quotaPeriod: QuotaPeriod.PER_TERM,
      videoQuotaPolicy: 'FIXED',
    });
  }

  async createVersion(id: string): Promise<CarePackage> {
    const source = await this.getAdmin(id);
    const latest = await this.repository.findLatestByCode(source.code);
    if (
      source.status === CarePackageStatus.DRAFT ||
      latest?.status === CarePackageStatus.DRAFT
    ) {
      throw new BusinessConflictException(
        CarePackageErrorCode.CARE_PACKAGE_CODE_EXISTS,
        'Vui lòng chỉnh sửa bản nháp hiện có trước khi tạo phiên bản mới.',
      );
    }
    if (source.id !== latest?.id) {
      throw new BusinessConflictException(
        CarePackageErrorCode.CARE_PACKAGE_INACTIVE,
        'Chỉ có thể tạo phiên bản mới từ phiên bản mới nhất của gói.',
      );
    }
    const {
      name,
      description,
      durationMonths,
      homeVisitUnitPriceVnd,
      priceVnd,
      includedMembers,
      maxMembers,
      additionalMemberMonthlyPriceVnd,
      quotas,
    } = source;
    return this.insertPackage(source.code, source.version + 1, {
      name,
      description,
      durationMonths,
      videoQuotaPolicy: 'FIXED',
      homeVisitUnitPriceVnd,
      priceVnd,
      includedMembers,
      maxMembers,
      additionalMemberMonthlyPriceVnd,
      quotaPeriod: QuotaPeriod.PER_TERM,
      quotas,
    });
  }

  async publish(id: string): Promise<CarePackage> {
    const draft = await this.getAdmin(id);
    validateCarePackageTerms(draft);
    await this.enforceRules(draft, true);
    return this.repository.publish(id);
  }

  async reopen(id: string): Promise<CarePackage> {
    const retired = await this.getAdmin(id);
    validateCarePackageTerms(retired);
    await this.enforceRules(retired, true);
    return this.repository.reopen(id);
  }

  retire(id: string): Promise<CarePackage> {
    return this.repository.retire(id);
  }

  async remove(
    id: string,
    actor?: { actorUserId?: string; clientIp?: string },
  ): Promise<{ id: string; deletedAt: string }> {
    const result = await this.repository.softDelete(id);
    await this.repository.recordAudit({
      actorUserId: actor?.actorUserId,
      clientIp: actor?.clientIp,
      action: 'CARE_PACKAGE_DELETED',
      packageId: id,
      details: { deletedAt: result.deletedAt },
    });
    return result;
  }

  private insertPackage(
    code: string,
    version: number,
    terms: CarePackageTerms,
    status: CarePackageStatus = CarePackageStatus.DRAFT,
  ): Promise<CarePackage> {
    validateCarePackageTerms(terms);
    const now = new Date().toISOString();
    return this.repository.insert({
      ...terms,
      id: randomUUID(),
      code,
      version,
      currency: 'VND',
      status,
      createdAt: now,
      updatedAt: now,
      publishedAt: status === CarePackageStatus.ACTIVE ? now : null,
      retiredAt: null,
    });
  }
}
