import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CarePackageStatus,
  type CarePackage,
  type CarePackageTerms,
} from '../../entities/care-package.entity';
import {
  CarePackagesRepository,
  type CarePackagesPage,
} from '../interfaces/care-packages.repository.interface';
import { validateCarePackageTerms } from '../../validate-care-package-terms';

// Bộ lưu trữ thử nghiệm: dữ liệu nằm trong RAM, mất khi backend khởi động lại.
// Không dùng để bán gói hoặc nhận tiền thật; sau này thay bằng adapter PostgreSQL.
@Injectable()
export class InMemoryCarePackagesRepository implements CarePackagesRepository {
  private readonly packages = new Map<string, CarePackage>(); // Khóa là UUID từng phiên bản.

  list(
    page: number,
    limit: number,
    status?: CarePackageStatus,
  ): Promise<CarePackagesPage> {
    // Lọc trước khi phân trang để total phản ánh đúng số bản ghi thỏa điều kiện.
    const items = [...this.packages.values()]
      .filter((item) => status === undefined || item.status === status)
      // Sắp theo mã gói, sau đó đưa phiên bản mới nhất của cùng mã lên trước.
      .sort((a, b) => a.code.localeCompare(b.code) || b.version - a.version);

    return Promise.resolve({
      // Cắt đúng trang và sao chép sâu để bên gọi không sửa ngược dữ liệu trong Map.
      items: structuredClone(items.slice((page - 1) * limit, page * limit)),
      total: items.length,
      page,
      limit,
    });
  }

  findById(id: string): Promise<CarePackage | null> {
    const item = this.packages.get(id);
    // Trả null nếu thiếu; việc chuyển thành lỗi HTTP được service quyết định.
    return Promise.resolve(item ? structuredClone(item) : null);
  }

  findLatestByCode(code: string): Promise<CarePackage | null> {
    // Lấy phiên bản có số lớn nhất, kể cả khi bản đó còn nháp hoặc đã ngừng bán.
    const latest = [...this.packages.values()]
      .filter((item) => item.code === code)
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
    if (current.status !== CarePackageStatus.DRAFT) {
      throw new ConflictException('Only draft packages can be edited');
    }
    const updated = {
      ...current,
      // Ghép thay đổi vào bản hiện tại; object quotas nếu có sẽ thay trọn bộ ba hạn mức.
      ...structuredClone(terms),
      updatedAt: new Date().toISOString(),
    };
    // Kiểm tra lại ngay trước khi ghi để các cập nhật đan xen không phá ràng buộc.
    validateCarePackageTerms(updated);
    this.packages.set(id, updated);
    return Promise.resolve(structuredClone(updated));
  }

  publish(id: string): Promise<CarePackage> {
    const current = this.requirePackage(id);
    // Không công bố lại ACTIVE hoặc phục hồi trực tiếp bản đã ngừng bán.
    if (current.status !== CarePackageStatus.DRAFT) {
      throw new ConflictException('Only draft packages can be published');
    }
    // Chặn công bố bản cũ khi cùng mã đã có phiên bản mới hơn.
    const newerVersionExists = [...this.packages.values()].some(
      (item) => item.code === current.code && item.version > current.version,
    );
    if (newerVersionExists) {
      throw new ConflictException(
        'Only the latest package version can be published',
      );
    }

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

  private requirePackage(id: string): CarePackage {
    // Hàm nội bộ lấy bản hiện tại để thao tác ghi; không trả object này trực tiếp ra API.
    const item = this.packages.get(id);
    if (!item) {
      throw new NotFoundException('Care package not found');
    }
    return item;
  }
}
