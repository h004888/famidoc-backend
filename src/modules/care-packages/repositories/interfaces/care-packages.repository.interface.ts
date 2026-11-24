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

// Gói seed có thể còn được tham chiếu bởi các hợp đồng thử đã tạo trước đây.
export const DEMO_CARE_PACKAGE_IDS = [
  '70000000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-000000000002',
  '70000000-0000-4000-8000-000000000003',
];

export const DEMO_CARE_PACKAGE_CODES = [
  'TRAI_NGHIEM',
  'DONG_HANH',
  'TOAN_DIEN',
].flatMap((code) => [`DEMO_${code}`, `DEMO_LOCAL_${code}`]);

export interface CarePackagesListOptions {
  excludeDemo?: boolean;
  excludeDrafts?: boolean;
  ascendingPrice?: boolean;
}

// Giao diện lưu trữ chung: service dùng lớp này, không biết dữ liệu nằm ở RAM hay DB.
// Các phương thức trả Promise để thay adapter database sau này mà giữ luồng gọi.
export const CARE_PACKAGES_REPOSITORY_TOKEN = Symbol('ICarePackagesRepository');

export interface CarePackagesRepository {
  list(
    page: number,
    limit: number,
    status?: CarePackageStatus,
    options?: CarePackagesListOptions,
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
  reopen(id: string): Promise<CarePackage>;
  retire(id: string): Promise<CarePackage>; // Không xóa bản ghi khỏi kho dữ liệu.
}
