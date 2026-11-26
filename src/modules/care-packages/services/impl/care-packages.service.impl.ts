import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { CreateCarePackageDto } from '../../dtos/create-care-package.dto';
import type {
  AdminListCarePackagesDto,
  ListCarePackagesDto,
} from '../../dtos/list-care-packages.dto';
import type { UpdateCarePackageDto } from '../../dtos/update-care-package.dto';
import {
  CarePackageStatus,
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
  blockingFindings,
  evaluateCarePackageLoad,
  evaluateCarePackageRules,
  maxContractVideoConsultations,
  warningFindings,
  type CarePackageLoad,
  type CarePackageRuleFinding,
} from '../../rules/care-package-rules';
import type { ValidateCarePackageDto } from '../../dtos/create-care-package.dto';

// Người thao tác và các cảnh báo đã được xác nhận cho một lần lưu/publish.
export interface CarePackageActionContext {
  actorUserId?: string;
  clientIp?: string;
  acknowledgedWarnings?: string[];
}

export interface CarePackageValidationResult {
  ok: boolean; // không có lỗi BLOCK
  requiresAcknowledgement: string[]; // mã WARN phải tick xác nhận
  findings: CarePackageRuleFinding[];
  load: CarePackageLoad;
  maxContractVideoConsultations: number | null;
}

@Injectable()
export class CarePackagesServiceImpl {
  // NestJS cấp repository qua DI; service không phụ thuộc trực tiếp vào Map hay Prisma.
  constructor(
    @Inject(CARE_PACKAGES_REPOSITORY_TOKEN)
    private readonly repository: CarePackagesRepository,
  ) {}

  // Danh mục công khai chỉ hiển thị phiên bản đang bán, không lộ bản nháp/lịch sử.
  listPublic(query: ListCarePackagesDto) {
    return this.repository.list(
      query.page,
      query.limit,
      CarePackageStatus.ACTIVE,
    );
  }

  // Quản trị được lọc theo trạng thái; quyền truy cập do guard ở controller kiểm tra.
  listAdmin(query: AdminListCarePackagesDto) {
    return this.repository.list(query.page, query.limit, query.status, {
      excludeDemo: true,
      excludeDrafts: query.excludeDrafts,
      ascendingPrice: true,
    });
  }

  async getPublic(id: string): Promise<CarePackage> {
    const item = await this.getAdmin(id);
    // Trả cùng lỗi 404 cho gói không tồn tại và gói chưa được phép công khai.
    if (item.status !== CarePackageStatus.ACTIVE) {
      throw new NotFoundException('Care package not found');
    }
    return item;
  }

  async quote(id: string, dto: QuoteCarePackageDto): Promise<CarePackageQuote> {
    // Luôn lấy giá/quyền lợi từ phiên bản ACTIVE trong kho, không nhận giá client tự gửi.
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
    // Báo giá không thu tiền và không tự chọn gói khác khi vượt trần.
    return calculateCarePackageQuote(carePackage, dto.memberCount, dto);
  }

  // Tra cứu nội bộ mọi trạng thái; module gọi vẫn phải tự kiểm tra quyền người dùng.
  async getAdmin(id: string): Promise<CarePackage> {
    const item = await this.repository.findById(id);
    if (!item) {
      throw new NotFoundException('Care package not found');
    }
    return item;
  }

  // Chạy toàn bộ quy tắc (có ngữ cảnh: gói đang bán, phiên bản trước, chạy thử xếp lịch).
  async validate(dto: ValidateCarePackageDto): Promise<CarePackageValidationResult> {
    const { code, packageId, ...terms } = dto;
    const current = packageId ? await this.repository.findById(packageId) : null;
    return this.evaluate(terms, code ?? current?.code, current ?? undefined, true);
  }

  private async evaluate(
    terms: CarePackageTerms,
    code: string | undefined,
    current: CarePackage | undefined,
    runDryRun: boolean,
  ): Promise<CarePackageValidationResult> {
    const active = await this.repository.list(1, 100, CarePackageStatus.ACTIVE, {
      excludeDemo: true,
    });
    // So giá với bản ACTIVE cùng mã (khi sửa bản nháp) hoặc với chính bản ACTIVE đang sửa.
    const previousVersion = code
      ? (active.items.find((p) => p.code === code && p.id !== current?.id) ??
        (current?.status === CarePackageStatus.ACTIVE ? current : null))
      : null;
    const findings = evaluateCarePackageRules(terms, {
      activePackages: active.items,
      previousVersion,
      code,
      runDryRun,
    });
    const contractCap =
      terms.videoQuotaPolicy === 'CONTRACT' ? maxContractVideoConsultations(terms) : null;
    return {
      ok: blockingFindings(findings).length === 0,
      requiresAcknowledgement: warningFindings(findings).map((f) => f.code),
      findings,
      load: evaluateCarePackageLoad(terms, contractCap ?? undefined),
      maxContractVideoConsultations: contractCap,
    };
  }

  // Lỗi BLOCK → 400; cảnh báo WARN chưa xác nhận → 409 kèm danh sách để form hiển thị.
  // Trả về các cảnh báo đã được xác nhận để ghi audit sau khi lưu thành công.
  private async enforceRules(
    terms: CarePackageTerms,
    code: string,
    current: CarePackage | undefined,
    ctx: CarePackageActionContext,
    runDryRun: boolean,
  ): Promise<CarePackageRuleFinding[]> {
    const result = await this.evaluate(terms, code, current, runDryRun);
    assertNoBlockingFindings(result.findings);
    const acknowledged = new Set(ctx.acknowledgedWarnings ?? []);
    const missing = result.requiresAcknowledgement.filter((c) => !acknowledged.has(c));
    if (missing.length > 0) {
      throw new ConflictException({
        message: 'Thay đổi có rủi ro, cần xác nhận đã hiểu trước khi lưu.',
        code: 'CARE_PACKAGE_RISK_ACK_REQUIRED',
        requiresAcknowledgement: missing,
        findings: warningFindings(result.findings),
      });
    }
    return warningFindings(result.findings);
  }

  private async auditAcknowledged(
    action: string,
    item: CarePackage,
    warnings: CarePackageRuleFinding[],
    ctx: CarePackageActionContext,
  ): Promise<void> {
    if (warnings.length === 0) return;
    await this.repository.recordAudit({
      actorUserId: ctx.actorUserId,
      clientIp: ctx.clientIp,
      action,
      packageId: item.id,
      details: {
        code: item.code,
        version: item.version,
        acknowledgedWarnings: warnings.map(({ code, message }) => ({ code, message })),
      },
    });
  }

  async create(
    dto: CreateCarePackageDto & { acknowledgedWarnings?: string[] },
    ctx: CarePackageActionContext = {},
  ): Promise<CarePackage> {
    // Mã đã tồn tại phải đi qua luồng tạo phiên bản, không được tạo lại từ phiên bản 1.
    if (await this.repository.findLatestByCode(dto.code)) {
      throw new ConflictException(
        'Package code exists; create a new version instead',
      );
    }
    const { code, acknowledgedWarnings, ...terms } = dto;
    const actionCtx = { ...ctx, acknowledgedWarnings: acknowledgedWarnings ?? ctx.acknowledgedWarnings };
    validateCarePackageTerms(terms);
    // Tạo mới là mở bán ngay nên phải chạy thử xếp lịch như khi publish.
    const warnings = await this.enforceRules(terms, code, undefined, actionCtx, true);
    const created = await this.insertPackage(code, 1, terms, CarePackageStatus.ACTIVE);
    await this.auditAcknowledged('CARE_PACKAGE_RISK_ACK_CREATE', created, warnings, actionCtx);
    return created;
  }

  async update(
    id: string,
    dto: UpdateCarePackageDto & { acknowledgedWarnings?: string[] },
    ctx: CarePackageActionContext = {},
  ): Promise<CarePackage> {
    const current = await this.getAdmin(id);
    // Cho phép admin chỉnh sửa trực tiếp gói dịch vụ theo yêu cầu
    if (current.status === CarePackageStatus.DEPRECATED) {
      throw new ConflictException('Cannot edit a deprecated package');
    }
    // Chỉ lấy trường thực sự được gửi; undefined không được xóa giá trị đang lưu.
    // Giữ lại số 0 và chuỗi rỗng vì đây có thể là giá trị cập nhật hợp lệ.
    const { acknowledgedWarnings, ...fields } = dto;
    const actionCtx = { ...ctx, acknowledgedWarnings: acknowledgedWarnings ?? ctx.acknowledgedWarnings };
    const changes = Object.fromEntries(
      Object.entries(fields).filter(([, value]) => value !== undefined),
    ) as Partial<CarePackageTerms>;
    // Body PATCH rỗng không thể hiện thay đổi nào nên được xem là yêu cầu sai.
    if (Object.keys(changes).length === 0) {
      throw new BadRequestException('Provide at least one field to update');
    }
    // Ghép dữ liệu cũ với phần thay đổi rồi mới kiểm tra ràng buộc giữa các trường.
    const merged = { ...current, ...changes };
    validateCarePackageTerms(merged);
    // Gói ACTIVE đổi là có hiệu lực ngay nên chạy thử xếp lịch luôn; bản nháp chạy khi publish.
    const warnings = await this.enforceRules(
      merged,
      current.code,
      current,
      actionCtx,
      current.status === CarePackageStatus.ACTIVE,
    );
    const updated = await this.repository.updateDraft(id, changes);
    await this.auditAcknowledged('CARE_PACKAGE_RISK_ACK_UPDATE', updated, warnings, actionCtx);
    return updated;
  }

  async createVersion(id: string): Promise<CarePackage> {
    const source = await this.getAdmin(id);
    const latest = await this.repository.findLatestByCode(source.code);
    // Nếu đã có bản nháp thì sửa bản đó, tránh phát sinh nhiều bản nháp cùng mã.
    if (
      source.status === CarePackageStatus.DRAFT ||
      latest?.status === CarePackageStatus.DRAFT
    ) {
      throw new ConflictException(
        'Edit the existing draft before creating another version',
      );
    }
    // Chỉ sao chép bản mới nhất để không đưa nhầm điều khoản lỗi thời sang phiên bản mới.
    if (source.id !== latest?.id) {
      throw new ConflictException(
        'Create a version from the latest package version',
      );
    }
    // Chỉ sao chép điều khoản, không sao chép ID, trạng thái hay ngày công bố bản cũ.
    const {
      name,
      description,
      durationMonths,
      videoQuotaPolicy,
      homeVisitUnitPriceVnd,
      priceVnd,
      includedMembers,
      maxMembers,
      additionalMemberMonthlyPriceVnd,
      quotaPeriod,
      quotas,
    } = source;
    // Bản mới có UUID riêng, tăng số phiên bản và bắt đầu lại ở trạng thái DRAFT.
    return this.insertPackage(source.code, source.version + 1, {
      name,
      description,
      durationMonths,
      videoQuotaPolicy,
      homeVisitUnitPriceVnd,
      priceVnd,
      includedMembers,
      maxMembers,
      additionalMemberMonthlyPriceVnd,
      quotaPeriod,
      quotas,
    });
  }

  async publish(id: string, ctx: CarePackageActionContext = {}): Promise<CarePackage> {
    // S6: publish bắt buộc chạy thử xếp lịch 5 gia đình và xác nhận các cảnh báo.
    const current = await this.getAdmin(id);
    const warnings = await this.enforceRules(current, current.code, current, ctx, true);
    // Repository đổi trạng thái các phiên bản cùng mã trong cùng thao tác ghi.
    const published = await this.repository.publish(id);
    await this.auditAcknowledged('CARE_PACKAGE_RISK_ACK_PUBLISH', published, warnings, ctx);
    return published;
  }

  async reopen(id: string, ctx: CarePackageActionContext = {}): Promise<CarePackage> {
    // Mở bán lại gói cũ cũng phải qua quy tắc hiện hành (gói 124 không thể mở lại).
    const current = await this.getAdmin(id);
    const warnings = await this.enforceRules(current, current.code, current, ctx, true);
    const reopened = await this.repository.reopen(id);
    await this.auditAcknowledged('CARE_PACKAGE_RISK_ACK_REOPEN', reopened, warnings, ctx);
    return reopened;
  }

  async retire(id: string): Promise<CarePackage> {
    // Ngừng bán chứ không xóa dữ liệu; không tự hủy hợp đồng đã mua gói.
    return this.repository.retire(id);
  }

  private insertPackage(
    code: string,
    version: number,
    terms: CarePackageTerms,
    status: CarePackageStatus = CarePackageStatus.DRAFT,
  ): Promise<CarePackage> {
    validateCarePackageTerms(terms);
    // Lưu thời gian chuẩn ISO/UTC để các phần khác đọc cùng một định dạng.
    const now = new Date().toISOString();
    return this.repository.insert({
      ...terms,
      id: randomUUID(), // ID do backend sinh, không lấy từ dữ liệu người dùng gửi.
      code,
      version,
      currency: 'VND', // Phần hiện tại chỉ hỗ trợ số tiền nguyên theo đồng Việt Nam.
      status,
      createdAt: now,
      updatedAt: now,
      publishedAt: status === CarePackageStatus.ACTIVE ? now : null,
      retiredAt: null, // Chỉ ghi khi ngừng bán hoặc được thay bằng bản mới.
    });
  }
}
