import { todayInVietnam } from '../../../core/business/business-helpers';
import { calculateRevenueShares } from './revenue-sharing';

const dayMs = 86_400_000;
export interface ServiceInvoice {
  settlementItems?: {
    recognitionYear: number | null;
    recognitionMonth: number | null;
    recognitionBasis: string;
    grossAmount: unknown;
    vatAmount: unknown;
    netAmount: unknown;
    platformFeeAmount: unknown;
    facilityShareAmount: unknown;
    serviceFrom: Date | null;
    serviceUntil: Date | null;
  }[];
  totalPayable: unknown;
  paidAt: Date | null;
  addendumId: string | null;
  addendum?: { activatedAt: Date | null } | null;
  contract: {
    startDate: Date;
    endDate: Date;
    terminatedAt: Date | null;
  } | null;
}

// Phân bổ bằng số tiền lũy kế tại hai mốc. Nhờ vậy cộng đủ các tháng luôn đúng tổng VND ban đầu.
export function allocateServiceDays(
  amount: number,
  from: Date,
  until: Date,
  start: Date,
  end: Date,
  stopAt = until,
) {
  const fullDays = Math.round((until.getTime() - from.getTime()) / dayMs);
  if (!Number.isSafeInteger(amount) || amount < 0 || fullDays <= 0) return null;
  const left = Math.max(from.getTime(), start.getTime());
  const right = Math.min(until.getTime(), end.getTime(), stopAt.getTime());
  if (right <= left) return null;
  const cumulative = (time: number) =>
    (BigInt(amount) * BigInt(Math.round((time - from.getTime()) / dayMs))) /
    BigInt(fullDays);
  const before = cumulative(left),
    after = cumulative(right);
  const grossVnd = Number(after - before);
  if (!grossVnd) return null;
  // Tính phí gộp 15% trên phần dịch vụ, chưa gán thuế suất cho phí nền tảng.
  const platformFeeVnd =
    calculateRevenueShares(Number(after), 0).platformFeeVnd -
    calculateRevenueShares(Number(before), 0).platformFeeVnd;
  return {
    grossVnd,
    vatVnd: 0,
    netVnd: grossVnd,
    platformFeeVnd,
    facilityShareVnd: grossVnd - platformFeeVnd,
    serviceFrom: new Date(left),
    serviceUntil: new Date(right),
  };
}

// Chỉ phân bổ thời gian thực sự có quyền phục vụ: sau thanh toán và sau lúc phụ lục có hiệu lực.
export function calculateMonthlyInvoiceShares(
  invoice: ServiceInvoice,
  period: { start: Date; end: Date },
  now = new Date(),
) {
  const last = new Date(period.end.getTime() + 7 * 3_600_000 - 1);
  const saved = invoice.settlementItems?.find(
    (i) =>
      i.recognitionYear === last.getUTCFullYear() &&
      i.recognitionMonth === last.getUTCMonth() + 1,
  );
  // Báo cáo kỳ đã lập dùng số chốt trong bảng kê, không tính lại theo dữ liệu hợp đồng đã đổi sau đó.
  if (saved)
    return {
      grossVnd: Number(saved.grossAmount),
      vatVnd: Number(saved.vatAmount),
      netVnd: Number(saved.netAmount),
      platformFeeVnd: Number(saved.platformFeeAmount),
      facilityShareVnd: Number(saved.facilityShareAmount),
      serviceFrom: saved.serviceFrom ?? todayInVietnam(period.start),
      serviceUntil: saved.serviceUntil ?? todayInVietnam(period.end),
    };
  if (
    invoice.settlementItems?.some((i) => i.recognitionBasis === 'LEGACY_CASH')
  )
    return null;
  const contract = invoice.contract;
  if (
    !contract ||
    !invoice.paidAt ||
    (invoice.addendumId && !invoice.addendum?.activatedAt)
  )
    return null;
  const from = new Date(
    Math.max(
      contract.startDate.getTime(),
      todayInVietnam(invoice.paidAt).getTime(),
      invoice.addendum?.activatedAt
        ? todayInVietnam(invoice.addendum.activatedAt).getTime()
        : 0,
    ),
  );
  const periodStart = todayInVietnam(period.start),
    periodEnd = todayInVietnam(period.end);
  // Ngày hiện tại chưa kết thúc: báo cáo chỉ ghi nhận các ngày đã phục vụ trọn vẹn.
  const stop = new Date(
    Math.min(
      todayInVietnam(now).getTime(),
      contract.terminatedAt
        ? todayInVietnam(contract.terminatedAt).getTime()
        : contract.endDate.getTime(),
    ),
  );
  return allocateServiceDays(
    Number(invoice.totalPayable),
    from,
    contract.endDate,
    periodStart,
    periodEnd,
    stop,
  );
}
