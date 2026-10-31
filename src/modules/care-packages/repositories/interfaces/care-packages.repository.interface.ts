import type {
  CarePackage,
  CarePackageStatus,
  CarePackageTerms,
} from '../../entities/care-package.entity';

export interface CarePackagesPage {
  items: CarePackage[];
  total: number; // Tổng bản ghi sau bộ lọc, không phải số phần tử riêng của trang hiện tại.
  page: number;
  limit: number;
}

// Giao diện lưu trữ chung: service dùng lớp này, không biết dữ liệu nằm ở RAM hay DB.
// Các phương thức trả Promise để thay adapter database sau này mà giữ luồng gọi.
export const CARE_PACKAGES_REPOSITORY_TOKEN = Symbol('ICarePackagesRepository');

export interface CarePackagesRepository {
  list(
    page: number,
    limit: number,
    status?: CarePackageStatus,
  ): Promise<CarePackagesPage>;
  findById(id: string): Promise<CarePackage | null>;
  // Tìm phiên bản có số lớn nhất, không chỉ tìm bản đang bán.
  findLatestByCode(code: string): Promise<CarePackage | null>;
  insert(carePackage: CarePackage): Promise<CarePackage>;
  updateDraft(
    id: string,
    terms: Partial<CarePackageTerms>,
  ): Promise<CarePackage>;
  // Adapter DB phải công bố bản mới/ngừng bán bản cũ một cách nguyên tử và giữ lịch sử.
  publish(id: string): Promise<CarePackage>;
  retire(id: string): Promise<CarePackage>; // Không xóa bản ghi khỏi kho dữ liệu.
}
