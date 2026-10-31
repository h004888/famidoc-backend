import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  CarePackageStatus,
  type CarePackage,
} from '../entities/care-package.entity';
import type { CarePackageQuote } from '../entities/care-package-quote.entity';

// Hàm tính độc lập: không ghi dữ liệu, không gọi SePay và không kích hoạt gói.
export function calculateCarePackageQuote(
  carePackage: CarePackage,
  memberCount: number,
): CarePackageQuote {
  // Kiểm tra lại cả khi module nội bộ gọi thẳng, không chỉ dựa vào DTO của HTTP.
  if (
    !Number.isSafeInteger(memberCount) ||
    memberCount < 1 ||
    memberCount > 100
  ) {
    throw new BadRequestException(
      'memberCount must be an integer between 1 and 100',
    );
  }
  if (carePackage.status !== CarePackageStatus.ACTIVE) {
    throw new NotFoundException('Care package not found');
  }
  if (memberCount > carePackage.maxMembers) {
    throw new BadRequestException(
      'memberCount exceeds the package member limit',
    );
  }

  // Nhà ít người hơn số người cơ bản vẫn trả giá gói, không tự giảm giá theo đầu người.
  const additionalCount = Math.max(
    0,
    memberCount - carePackage.includedMembers,
  );

  // Dùng BigInt khi nhân/cộng tiền để không làm tròn sai số trước khi kiểm tra trần.
  const basePrice = BigInt(carePackage.priceVnd);
  const monthlyExtraPrice = BigInt(carePackage.additionalMemberMonthlyPriceVnd);
  const termExtraPrice = monthlyExtraPrice * BigInt(carePackage.durationMonths);
  const additionalTotal = termExtraPrice * BigInt(additionalCount);
  const totalPrice = basePrice + additionalTotal;

  // JSON trả tiền dạng number; chỉ chuyển khi mọi số tiền đều biểu diễn nguyên chính xác.
  // Trần DECIMAL(12,2) của hợp đồng/hóa đơn; VND chỉ dùng phần nguyên.
  const maximum = 9_999_999_999n;
  if (
    [
      basePrice,
      monthlyExtraPrice,
      termExtraPrice,
      additionalTotal,
      totalPrice,
    ].some((amount) => amount > maximum)
  ) {
    throw new BadRequestException(
      'Calculated price exceeds the supported VND range',
    );
  }

  return {
    kind: 'NEW_PURCHASE_ESTIMATE',
    binding: false,
    calculatedAt: new Date().toISOString(),
    package: {
      id: carePackage.id,
      code: carePackage.code,
      version: carePackage.version,
      name: carePackage.name,
      durationMonths: carePackage.durationMonths,
    },
    members: {
      requestedCount: memberCount,
      includedCount: carePackage.includedMembers,
      additionalCount,
      maxCount: carePackage.maxMembers,
    },
    pricing: {
      currency: 'VND',
      basePriceVnd: Number(basePrice),
      additionalMemberMonthlyPriceVnd: Number(monthlyExtraPrice),
      additionalMemberTermPriceVnd: Number(termExtraPrice),
      additionalMembersTotalVnd: Number(additionalTotal),
      totalPriceVnd: Number(totalPrice),
    },
    benefits: {
      // Giữ nguyên chu kỳ và ba hạn mức của phiên bản gói, không nhân theo số người/tháng.
      quotaPeriod: carePackage.quotaPeriod,
      quotas: structuredClone(carePackage.quotas),
      sharedAcrossMembers: true,
    },
  };
}
