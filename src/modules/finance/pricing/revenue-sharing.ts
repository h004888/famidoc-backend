import { BadRequestException } from '@nestjs/common';
export function calculateRevenueShares(grossVnd: number, vatVnd: number) {
  if (
    !Number.isSafeInteger(grossVnd) ||
    !Number.isSafeInteger(vatVnd) ||
    grossVnd < 0 ||
    vatVnd < 0 ||
    vatVnd > grossVnd
  )
    throw new BadRequestException('Invalid invoice amounts');
  const netVnd = grossVnd - vatVnd;
  // Thuế đã ghi riêng trên hóa đơn. Không tự áp thêm 8%/10% cho mọi dịch vụ.
  // Tiền VND nguyên: làm tròn xuống phần 15%, phần còn lại vào CSYT để không lệch tổng.
  const platformFeeVnd = Number((BigInt(netVnd) * 15n) / 100n);
  return {
    grossVnd,
    vatVnd,
    netVnd,
    platformFeeVnd,
    facilityShareVnd: netVnd - platformFeeVnd,
  };
}
