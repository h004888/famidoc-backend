// Các enum/interface chỉ mô tả dữ liệu TypeScript, không tự tạo bảng database.
export enum CarePackageStatus {
  DRAFT = 'DRAFT', // Bản nháp còn được sửa, chưa hiển thị công khai.
  ACTIVE = 'ACTIVE', // Bản đang bán, khóa việc sửa giá/quyền lợi trực tiếp.
  DEPRECATED = 'DEPRECATED', // Đã ngừng bán nhưng vẫn giữ lịch sử điều khoản.
}

export enum QuotaPeriod {
  PER_TERM = 'PER_TERM', // Hạn mức cho toàn thời hạn gói.
  PER_MONTH = 'PER_MONTH', // Hạn mức cho mỗi tháng hợp đồng, không mặc định là tháng dương lịch.
}

export interface CarePackageQuotas {
  videoConsultations: number;
  homeVisits: number;
  facilityVisits: number;
}

// Điều khoản có thể chỉnh ở DRAFT hoặc sao chép sang phiên bản mới.
export interface CarePackageTerms {
  name: string;
  description: string;
  durationMonths: number;
  priceVnd: number; // Giá trọn kỳ cho số người cơ bản.
  includedMembers: number; // Số người đã nằm trong giá trên.
  maxMembers: number; // Tổng số người tối đa sau khi bổ sung.
  additionalMemberMonthlyPriceVnd: number; // Chưa tính prorata hay tổng báo giá tại đây.
  quotaPeriod: QuotaPeriod;
  quotas: CarePackageQuotas;
}

export interface CarePackage extends CarePackageTerms {
  id: string; // UUID riêng cho từng phiên bản, dùng khi hợp đồng tham chiếu gói.
  code: string; // Mã chung của một dòng gói, không đổi qua các phiên bản.
  version: number; // Tăng dần từ 1; bản mới không ghi đè điều khoản bản cũ.
  currency: 'VND';
  status: CarePackageStatus;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null; // null khi phiên bản chưa từng công bố.
  retiredAt: string | null; // null khi chưa ngừng bán.
}
