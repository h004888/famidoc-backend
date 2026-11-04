import type { CarePackageQuotas, QuotaPeriod } from './care-package.entity';

// Kết quả tính tham khảo, không phải hóa đơn, hợp đồng hay bằng chứng đã thanh toán.
// Không có quoteId dùng mua hàng vì báo giá hiện chưa được lưu bền vững.
export interface CarePackageQuote {
  kind: 'NEW_PURCHASE_ESTIMATE';
  binding: false; // Checkout phải lấy lại giá và kiểm tra điều kiện hợp đồng ở backend.
  calculatedAt: string;
  package: {
    id: string; // UUID của chính phiên bản được dùng để tính.
    code: string;
    version: number;
    name: string;
    durationMonths: number;
  };
  members: {
    requestedCount: number;
    includedCount: number;
    additionalCount: number;
    maxCount: number;
  };
  pricing: {
    currency: 'VND';
    basePriceVnd: number; // Giá trọn kỳ đã bao gồm số người cơ bản.
    additionalMemberMonthlyPriceVnd: number; // Đơn giá bổ sung một người/tháng.
    additionalMemberTermPriceVnd: number; // Đơn giá bổ sung một người cho toàn kỳ.
    additionalMembersTotalVnd: number; // Tổng phụ phí cho mọi người bổ sung.
    totalPriceVnd: number; // Giá cơ bản cộng phụ phí, không tự thêm khoản phí chưa cấu hình.
  };
  benefits: {
    quotaPeriod: QuotaPeriod;
    quotas: CarePackageQuotas;
    sharedAcrossMembers: true; // Thêm người không tự nhân số lượt video/khám của gói.
  };
}
