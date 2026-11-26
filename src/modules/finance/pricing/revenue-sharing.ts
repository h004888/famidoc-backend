import { BadRequestException } from '@nestjs/common';
import { DEFAULT_PLATFORM_COMMISSION_PERCENT } from './platform-rate';
export function calculateRevenueShares(
  grossVnd: number,
  vatVnd: number,
  platformRatePercent: number = DEFAULT_PLATFORM_COMMISSION_PERCENT,
) {
  if (
    !Number.isSafeInteger(grossVnd) ||
    !Number.isSafeInteger(vatVnd) ||
    grossVnd < 0 ||
    vatVnd < 0 ||
    vatVnd > grossVnd
  )
    throw new BadRequestException('Invalid invoice amounts');
  if (!Number.isFinite(platformRatePercent) || platformRatePercent < 0 || platformRatePercent > 100)
    throw new BadRequestException('Invalid platform commission rate');
  // Tỷ lệ có tối đa 2 chữ số thập phân (Decimal(5,2)) nên quy ra phần vạn để tính số nguyên.
  const rateBasisPoints = BigInt(Math.round(platformRatePercent * 100));
  const netVnd = grossVnd - vatVnd;
  // Thuế đã ghi riêng trên hóa đơn. Không tự áp thêm 8%/10% cho mọi dịch vụ.
  // Tiền VND nguyên: làm tròn xuống phần hoa hồng, phần còn lại vào CSYT để không lệch tổng.
  const platformFeeVnd = Number((BigInt(netVnd) * rateBasisPoints) / 10000n);
  return {
    grossVnd,
    vatVnd,
    netVnd,
    platformFeeVnd,
    facilityShareVnd: netVnd - platformFeeVnd,
  };
}
