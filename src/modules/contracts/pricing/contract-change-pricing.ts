import { BadRequestException, ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { BillingContract } from '../../payments/entities/payment.entity';
export type FrozenContractTerms = BillingContract['packageSnapshot'];
export function readFrozenContractTerms(
  value: Prisma.JsonValue | null,
): FrozenContractTerms {
  const terms = value as unknown as FrozenContractTerms;
  if (
    !terms?.package ||
    !terms?.pricing ||
    !terms?.members ||
    !terms?.benefits?.quotas ||
    !Number.isSafeInteger(terms.pricing.totalPriceVnd)
  )
    throw new ConflictException(
      'Contract has no valid frozen price/benefit snapshot',
    );
  return structuredClone(terms);
}
export function calculateHomeVisitAddendum(
  terms: FrozenContractTerms,
  visits: number,
) {
  const quota = terms.benefits.quotas.homeVisits;
  if (quota <= 0 || terms.benefits.quotaPeriod !== 'PER_TERM')
    throw new ConflictException(
      'This contract has no supported home-visit price',
    );
  const unitPrice = terms.pricing.basePriceVnd / quota;
  if (!Number.isSafeInteger(unitPrice))
    throw new ConflictException(
      'Configure an explicit whole-VND home-visit unit price',
    );
  return ensureSupportedAmount(unitPrice * visits);
}
export function calculateMemberAddendum(
  terms: FrozenContractTerms,
  addedCount: number,
  startDate: Date,
  endDate: Date,
  today: Date,
) {
  if (addedCount === 0) return 0;
  const totalDays = BigInt(
    Math.round((endDate.getTime() - startDate.getTime()) / 86400000),
  );
  const remainingDays = BigInt(
    Math.round(
      (endDate.getTime() - Math.max(today.getTime(), startDate.getTime())) /
        86400000,
    ),
  );
  if (totalDays <= 0n || remainingDays <= 0n)
    throw new ConflictException('The contract has no remaining service days');
  const numerator =
    BigInt(addedCount) *
    BigInt(terms.pricing.additionalMemberMonthlyPriceVnd) *
    BigInt(terms.package.durationMonths) *
    remainingDays;
  // Cộng toàn bộ phụ phí rồi mới làm tròn lên 1.000đ một lần, đúng cách tính giữa kỳ.
  const denominator = totalDays * 1000n;
  return ensureSupportedAmount(
    Number(((numerator + denominator - 1n) / denominator) * 1000n),
  );
}
export function ensureSupportedAmount(amount: number) {
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 9999999999)
    throw new BadRequestException(
      'Calculated amount is outside the supported VND range',
    );
  return amount;
}
