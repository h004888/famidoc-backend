import { createTermsHash, todayInVietnam } from '../../../core/business/business-helpers';

const DAY_MS = 86_400_000;
const VN_OFFSET_MS = 7 * 3_600_000;

/**
 * Chuẩn hóa Date về mốc 00:00:00Z của ngày lịch Việt Nam (UTC+7).
 */
export function toVnCalendarMidnight(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

/**
 * Định dạng Date (UTC midnight) thành chuỗi YYYY-MM-DD.
 */
export function formatIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Tính hạn cuối thanh toán gia hạn theo quy tắc R9:
 * - Case A: now + 24 giờ
 * - Case B: min(now + 24 giờ, cuối ngày cuối ân hạn theo giờ VN 23:59:59.999+07:00)
 */
export function computeRenewalPaymentDeadline(
  now: Date,
  caseType: 'CASE_A' | 'CASE_B',
  oldEndDate: Date,
  graceDays: number,
): Date {
  const twentyFourHoursLater = new Date(now.getTime() + DAY_MS);
  if (caseType === 'CASE_A') {
    return twentyFourHoursLater;
  }
  const endVnMidnight = toVnCalendarMidnight(oldEndDate);
  const graceEndVnMidnight = new Date(endVnMidnight.getTime() + graceDays * DAY_MS);
  // 23:59:59.999 giờ VN (UTC+7) của ngày graceEnd = +17h - 1ms so với 00:00:00Z cùng ngày.
  const graceEndTimestamp = new Date(
    graceEndVnMidnight.getTime() + DAY_MS - VN_OFFSET_MS - 1,
  );
  return twentyFourHoursLater.getTime() <= graceEndTimestamp.getTime()
    ? twentyFourHoursLater
    : graceEndTimestamp;
}

/**
 * Tính mã băm SHA-256 nhất quán cho bản xem trước & xác nhận gia hạn hợp đồng (R8).
 */
export function computeRenewalTermsHash(input: {
  sourceContractId: string;
  packageId: string;
  totalPriceVnd: number;
  expectedStartDate: string;
  expectedEndDate: string;
  memberIds: string[];
}): string {
  return createTermsHash({
    flow: 'CONTRACT_RENEWAL_R8',
    sourceContractId: input.sourceContractId,
    packageId: input.packageId,
    totalPriceVnd: input.totalPriceVnd,
    expectedStartDate: input.expectedStartDate,
    expectedEndDate: input.expectedEndDate,
    memberIds: [...input.memberIds].sort(),
  });
}

export function computeGraceEndDate(oldEndDate: Date, graceDays: number): Date {
  const endVnMidnight = toVnCalendarMidnight(oldEndDate);
  return new Date(endVnMidnight.getTime() + graceDays * DAY_MS);
}

export function computeVietnamToday(now = new Date()): Date {
  return todayInVietnam(now);
}
