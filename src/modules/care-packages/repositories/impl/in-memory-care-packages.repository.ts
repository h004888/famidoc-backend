import {
  ConflictException,
  Injectable,
} from '@nestjs/common';
import {
  BusinessConflictException,
  ResourceNotFoundException,
} from '../../../../core/exceptions/api.exception';
import { CarePackageErrorCode } from '../../../../core/constants/error-codes.constant';
import {
  CarePackageStatus,
  type CarePackage,
  type CarePackageTerms,
} from '../../entities/care-package.entity';
import {
  CarePackagesRepository,
  DEMO_CARE_PACKAGE_CODES,
  DEMO_CARE_PACKAGE_IDS,
  type CarePackageAuditEntry,
  type CarePackagesListOptions,
  type CarePackagesPage,
} from '../interfaces/care-packages.repository.interface';
import { validateCarePackageTerms } from '../../validate-care-package-terms';

// Bộ lưu trữ thử nghiệm: dữ liệu nằm trong RAM, mất khi backend khởi động lại.
// Không dùng để bán gói hoặc nhận tiền thật; sau này thay bằng adapter PostgreSQL.
@Injectable()
export class InMemoryCarePackagesRepository implements CarePackagesRepository {
  private readonly packages = new Map<string, CarePackage>(); // Khóa là UUID từng phiên bản.
  private readonly deletedIds = new Set<string>();
  readonly inUseIds = new Set<string>();
  readonly auditEntries: CarePackageAuditEntry[] = [];

  recordAudit(entry: CarePackageAuditEntry): Promise<void> {
    this.auditEntries.push(entry);
    return Promise.resolve();
  }

  list(
    page: number,
    limit: number,
    status?: CarePackageStatus,
    options?: CarePackagesListOptions,
  ): Promise<CarePackagesPage> {
    // Lọc trước khi phân trang để total phản ánh đúng số bản ghi thỏa điều kiện.
    const putRetiredLast = !status && options?.excludeDrafts;
    const items = [...this.packages.values()]
      .filter((item) => !this.deletedIds.has(item.id))
      .filter((item) => status !== undefined
        ? item.status === status
        : !options?.excludeDrafts || item.status !== CarePackageStatus.DRAFT,
      )
      .filter((item) => !options?.excludeDemo || (
        !DEMO_CARE_PACKAGE_IDS.includes(item.id) &&
        !DEMO_CARE_PACKAGE_CODES.includes(item.code)
      ))
      .sort((a, b) =>
        (putRetiredLast
          ? Number(a.status === CarePackageStatus.DEPRECATED) - Number(b.status === CarePackageStatus.DEPRECATED)
          : 0) ||
        (options?.ascendingPrice ? a.priceVnd - b.priceVnd : 0) ||
        a.code.localeCompare(b.code) ||
        b.version - a.version,
      );

    return Promise.resolve({
      // Cắt đúng trang và sao chép sâu để bên gọi không sửa ngược dữ liệu trong Map.
      items: structuredClone(items.slice((page - 1) * limit, page * limit)),
      total: items.length,
      page,
      limit,
    });
  }

  findById(id: string): Promise<CarePackage | null> {
    if (this.deletedIds.has(id)) return Promise.resolve(null);
    const item = this.packages.get(id);
    // Trả null nếu thiếu; việc chuyển thành lỗi HTTP được service quyết định.
    return Promise.resolve(item ? structuredClone(item) : null);
  }

  findLatestByCode(code: string): Promise<CarePackage | null> {
    // Lấy phiên bản có số lớn nhất, kể cả khi bản đó còn nháp hoặc đã ngừng bán.
    const latest = [...this.packages.values()]
      .filter((item) => !this.deletedIds.has(item.id) && item.code === code)
      .sort((a, b) => b.version - a.version)[0];
    return Promise.resolve(latest ? structuredClone(latest) : null);
  }

  insert(carePackage: CarePackage): Promise<CarePackage> {
    // Kiểm tra tại điểm ghi để hai yêu cầu tạo đồng thời không chèn trùng mã/phiên bản.
    if (
      this.packages.has(carePackage.id) ||
      [...this.packages.values()].some(
        (item) =>
          item.code === carePackage.code &&
          item.version === carePackage.version,
      )
    ) {
      throw new ConflictException('Package code and version already exist');
    }
    // Tách object lưu nội bộ khỏi object đầu vào và object trả về.
    this.packages.set(carePackage.id, structuredClone(carePackage));
    return Promise.resolve(structuredClone(carePackage));
  }

  updateDraft(
    id: string,
    terms: Partial<CarePackageTerms>,
  ): Promise<CarePackage> {
    const current = this.requirePackage(id);
    // Kiểm tra lại trạng thái mới nhất, phòng gói đã được công bố sau khi service đọc.
    if (current.status === CarePackageStatus.DEPRECATED) {
      throw new ConflictException('Cannot edit a deprecated package');
    }
    const updated = {
      ...current,
      // Ghép thay đổi vào bản hiện tại; object quotas nếu có sẽ thay trọn bộ hai hạn mức.
      ...structuredClone(terms),
      updatedAt: new Date().toISOString(),
    };
    // Kiểm tra lại ngay trước khi ghi để các cập nhật đan xen không phá ràng buộc.
    validateCarePackageTerms(updated);
    this.packages.set(id, updated);
    return Promise.resolve(structuredClone(updated));
  }

  publish(id: string): Promise<CarePackage> {
    return this.activate(id, CarePackageStatus.DRAFT);
  }

  reopen(id: string): Promise<CarePackage> {
    return this.activate(id, CarePackageStatus.DEPRECATED);
  }

  private activate(id: string, expectedStatus: CarePackageStatus.DRAFT | CarePackageStatus.DEPRECATED): Promise<CarePackage> {
    const current = this.requirePackage(id);
    if (current.status !== expectedStatus) {
      throw new ConflictException(expectedStatus === CarePackageStatus.DRAFT
        ? 'Only draft packages can be published'
        : 'Chỉ có thể mở bán lại gói đã ngừng bán. Hãy tải lại danh mục.');
    }
    // Chặn công bố bản cũ khi cùng mã đã có phiên bản mới hơn.
    const newerVersionExists = [...this.packages.values()].some(
      (item) => item.code === current.code && item.version > current.version &&
        (expectedStatus === CarePackageStatus.DRAFT || item.status !== CarePackageStatus.DRAFT),
    );
    if (newerVersionExists) {
      throw new ConflictException(
        expectedStatus === CarePackageStatus.DRAFT
          ? 'Only the latest package version can be published'
          : 'Gói đã có phiên bản mới hơn. Vui lòng mở bán phiên bản mới nhất.',
      );
    }

    validateCarePackageTerms(current);
    const now = new Date().toISOString();
    // Ngừng bán bản ACTIVE cũ nhưng giữ nguyên giá/quyền lợi để tham chiếu lịch sử.
    for (const item of this.packages.values()) {
      if (
        item.code === current.code &&
        item.status === CarePackageStatus.ACTIVE
      ) {
        this.packages.set(item.id, {
          ...item,
          status: CarePackageStatus.DEPRECATED,
          retiredAt: now,
          updatedAt: now,
        });
      }
    }
    // Sau khi hạ bản cũ, đưa bản nháp được chọn lên ACTIVE.
    // Đoạn này không có await nên không bị xen ngang trong một tiến trình Node.js;
    // adapter database sau này phải dùng transaction và ràng buộc dữ liệu tương ứng.
    const published: CarePackage = {
      ...current,
      status: CarePackageStatus.ACTIVE,
      publishedAt: now,
      retiredAt: null,
      updatedAt: now,
    };
    this.packages.set(id, published);
    return Promise.resolve(structuredClone(published));
  }

  retire(id: string): Promise<CarePackage> {
    const current = this.requirePackage(id);
    // Gọi lại yêu cầu ngừng bán không làm thay đổi ngày ngừng bán đã ghi trước đó.
    if (current.status === CarePackageStatus.DEPRECATED) {
      return Promise.resolve(structuredClone(current));
    }
    // Bản nháp chưa từng được bán nên không đi qua thao tác ngừng bán.
    if (current.status !== CarePackageStatus.ACTIVE) {
      throw new ConflictException('Only active packages can be retired');
    }
    const now = new Date().toISOString();
    // Giữ bản ghi, chỉ đổi trạng thái và cập nhật dấu thời gian.
    const retired: CarePackage = {
      ...current,
      status: CarePackageStatus.DEPRECATED,
      retiredAt: now,
      updatedAt: now,
    };
    this.packages.set(id, retired);
    return Promise.resolve(structuredClone(retired));
  }

  softDelete(id: string): Promise<{ id: string; deletedAt: string }> {
    const current = this.requirePackage(id);
    if (current.status === CarePackageStatus.ACTIVE) {
      throw new BusinessConflictException(
        CarePackageErrorCode.CARE_PACKAGE_ACTIVE_DELETE_BLOCKED,
        'Không thể xóa gói đang mở bán. Vui lòng ngừng bán gói trước khi xóa.',
        'Không thể xóa gói đang mở bán. Vui lòng ngừng bán gói trước khi xóa.',
        {
          conditions: [
            {
              code: 'PKG_STATUS',
              condition: 'status phải là DEPRECATED hoặc DRAFT',
              message: 'Gói hiện đang ở trạng thái Đang bán (ACTIVE).',
            },
          ],
        },
      );
    }
    if (this.inUseIds.has(id)) {
      const msg = 'Không thể xóa gói vì đang có 1 hợp đồng hoặc yêu cầu ghép nối sử dụng gói này.';
      throw new BusinessConflictException(
        CarePackageErrorCode.CARE_PACKAGE_IN_USE,
        msg,
        msg,
        {
          conditions: [
            {
              code: 'PKG_IN_USE',
              condition: 'Không còn hợp đồng hoặc phiên ghép nối liên kết với gói',
              message: 'Đang có 1 hợp đồng/phiên ghép nối liên kết với gói.',
            },
          ],
        },
      );
    }
    const deletedAt = new Date().toISOString();
    this.deletedIds.add(id);
    this.packages.set(id, {
      ...current,
      status: CarePackageStatus.DEPRECATED,
      retiredAt: current.retiredAt ?? deletedAt,
      updatedAt: deletedAt,
    });
    return Promise.resolve({ id, deletedAt });
  }

  private requirePackage(id: string): CarePackage {
    // Hàm nội bộ lấy bản hiện tại để thao tác ghi; không trả object này trực tiếp ra API.
    const item = this.deletedIds.has(id) ? undefined : this.packages.get(id);
    if (!item) {
      throw new ResourceNotFoundException(
        CarePackageErrorCode.CARE_PACKAGE_NOT_FOUND,
        'Không tìm thấy gói dịch vụ.',
      );
    }
    return item;
  }
}
