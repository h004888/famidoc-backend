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
    return this.repository.list(query.page, query.limit, query.status);
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
    // Chỉ tính mua mới trọn kỳ; chưa tính thêm người giữa kỳ, gia hạn hay nâng gói.
    return calculateCarePackageQuote(carePackage, dto.memberCount);
  }

  // Tra cứu nội bộ mọi trạng thái; module gọi vẫn phải tự kiểm tra quyền người dùng.
  async getAdmin(id: string): Promise<CarePackage> {
    const item = await this.repository.findById(id);
    if (!item) {
      throw new NotFoundException('Care package not found');
    }
    return item;
  }

  async create(dto: CreateCarePackageDto): Promise<CarePackage> {
    // Mã đã tồn tại phải đi qua luồng tạo phiên bản, không được tạo lại từ phiên bản 1.
    if (await this.repository.findLatestByCode(dto.code)) {
      throw new ConflictException(
        'Package code exists; create a new version instead',
      );
    }
    const { code, ...terms } = dto;
    // Server tự cấp phiên bản đầu tiên; mô tả không gửi lên được chuẩn hóa thành rỗng.
    return this.insertDraft(code, 1, {
      ...terms,
      description: dto.description ?? '',
    });
  }

  async update(id: string, dto: UpdateCarePackageDto): Promise<CarePackage> {
    const current = await this.getAdmin(id);
    // Không sửa giá/quyền lợi bản đã công bố để giữ điều khoản của phiên bản cũ.
    if (current.status !== CarePackageStatus.DRAFT) {
      throw new ConflictException(
        'Published terms are immutable; create a new version',
      );
    }
    // Chỉ lấy trường thực sự được gửi; undefined không được xóa giá trị đang lưu.
    // Giữ lại số 0 và chuỗi rỗng vì đây có thể là giá trị cập nhật hợp lệ.
    const changes = Object.fromEntries(
      Object.entries(dto).filter(([, value]) => value !== undefined),
    ) as Partial<CarePackageTerms>;
    // Body PATCH rỗng không thể hiện thay đổi nào nên được xem là yêu cầu sai.
    if (Object.keys(changes).length === 0) {
      throw new BadRequestException('Provide at least one field to update');
    }
    // Ghép dữ liệu cũ với phần thay đổi rồi mới kiểm tra ràng buộc giữa các trường.
    validateCarePackageTerms({ ...current, ...changes });
    return this.repository.updateDraft(id, changes);
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
      priceVnd,
      includedMembers,
      maxMembers,
      additionalMemberMonthlyPriceVnd,
      quotaPeriod,
      quotas,
    } = source;
    // Bản mới có UUID riêng, tăng số phiên bản và bắt đầu lại ở trạng thái DRAFT.
    return this.insertDraft(source.code, source.version + 1, {
      name,
      description,
      durationMonths,
      priceVnd,
      includedMembers,
      maxMembers,
      additionalMemberMonthlyPriceVnd,
      quotaPeriod,
      quotas,
    });
  }

  async publish(id: string): Promise<CarePackage> {
    // Repository đổi trạng thái các phiên bản cùng mã trong cùng thao tác ghi.
    return this.repository.publish(id);
  }

  async retire(id: string): Promise<CarePackage> {
    // Ngừng bán chứ không xóa dữ liệu; không tự hủy hợp đồng đã mua gói.
    return this.repository.retire(id);
  }

  private insertDraft(
    code: string,
    version: number,
    terms: CarePackageTerms,
  ): Promise<CarePackage> {
    // Dùng chung bước tạo bản nháp cho cả gói mới và phiên bản kế tiếp.
    validateCarePackageTerms(terms);
    // Lưu thời gian chuẩn ISO/UTC để các phần khác đọc cùng một định dạng.
    const now = new Date().toISOString();
    return this.repository.insert({
      ...terms,
      id: randomUUID(), // ID do backend sinh, không lấy từ dữ liệu người dùng gửi.
      code,
      version,
      currency: 'VND', // Phần hiện tại chỉ hỗ trợ số tiền nguyên theo đồng Việt Nam.
      status: CarePackageStatus.DRAFT, // Tạo mới không đồng nghĩa được bán ngay.
      createdAt: now,
      updatedAt: now,
      publishedAt: null, // Chỉ ghi khi công bố thành công.
      retiredAt: null, // Chỉ ghi khi ngừng bán hoặc được thay bằng bản mới.
    });
  }
}
