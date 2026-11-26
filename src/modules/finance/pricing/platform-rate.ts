export const DEFAULT_PLATFORM_COMMISSION_PERCENT = 15;

export interface StaffingRateRow {
  platformCommissionRate: unknown;
  startDate: Date;
  endDate: Date;
}

// Tỷ lệ hoa hồng nền tảng theo hợp đồng B2B của cơ sở có hiệu lực tại ngày thanh toán.
// Không có hợp đồng phủ ngày đó thì dùng hợp đồng gần nhất theo ngày bắt đầu, cuối cùng mới về 15%.
export function resolvePlatformRatePercent(
  contracts: readonly StaffingRateRow[] | null | undefined,
  at: Date | null | undefined,
): number {
  if (!contracts?.length) return DEFAULT_PLATFORM_COMMISSION_PERCENT;
  const time = at?.getTime();
  const covering =
    time === undefined
      ? undefined
      : contracts
          .filter((c) => c.startDate.getTime() <= time && time <= c.endDate.getTime() + 86_399_999)
          .sort((a, b) => b.startDate.getTime() - a.startDate.getTime())[0];
  const chosen =
    covering ??
    [...contracts].sort((a, b) => b.startDate.getTime() - a.startDate.getTime())[0];
  const rate = Number(chosen.platformCommissionRate);
  return Number.isFinite(rate) && rate >= 0 && rate <= 100
    ? rate
    : DEFAULT_PLATFORM_COMMISSION_PERCENT;
}
