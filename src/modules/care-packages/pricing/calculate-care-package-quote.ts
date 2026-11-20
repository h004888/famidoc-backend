import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  CarePackageStatus,
  type CarePackage,
} from '../entities/care-package.entity';
import {
  DoctorTier,
  doctorSurcharges,
  type QuoteOptions,
} from './doctor-pricing';
import type { CarePackageQuote } from '../entities/care-package-quote.entity';

// Hàm tính độc lập: không ghi dữ liệu, không gọi SePay và không kích hoạt gói.
export function calculateCarePackageQuote(
  carePackage: CarePackage,
  memberCount: number,
  options?: QuoteOptions,
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
    throw new BadRequestException({
      message: 'Số người vượt trần gói đang chọn.',
      code: 'PACKAGE_MEMBER_LIMIT',
      maxMembers: carePackage.maxMembers,
      requestedMembers: memberCount,
      suggestHigherPackage: true,
    });
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
  const tier = options?.doctorTier ?? DoctorTier.STANDARD;
  if (!(tier in doctorSurcharges))
    throw new BadRequestException('Loại bác sĩ không hợp lệ.');
  const extraVisits = options?.extraHomeVisits ?? 0;
  if (!Number.isInteger(extraVisits) || extraVisits < 0 || extraVisits > 100)
    throw new BadRequestException('Số lượt mua thêm phải từ 0 đến 100.');
  const unitPrice =
    carePackage.homeVisitUnitPriceVnd ??
    (carePackage.quotas.homeVisits > 0
      ? carePackage.priceVnd / carePackage.quotas.homeVisits
      : 0);
  const surcharge = doctorSurcharges[tier];
  if (extraVisits && (!Number.isSafeInteger(unitPrice) || unitPrice <= 0))
    throw new BadRequestException('Gói chưa có đơn giá khám tại nhà hợp lệ.');
  // Phụ thu bác sĩ tính theo lần khám của cả gia đình, không nhân số người; mốc 250.000đ đã gồm trong giá gói.
  const doctorTotal = BigInt(carePackage.quotas.homeVisits) * BigInt(surcharge);
  const extraTotal = extraVisits
    ? BigInt(extraVisits) * BigInt(unitPrice + surcharge)
    : 0n;
  const totalPrice = basePrice + additionalTotal + doctorTotal + extraTotal;
  const quotas = structuredClone(carePackage.quotas);
  quotas.homeVisits += extraVisits;
  if (carePackage.videoQuotaPolicy === 'CONTRACT') {
    if (
      options?.videoConsultations !== undefined &&
      (!Number.isInteger(options.videoConsultations) ||
        options.videoConsultations < 1 ||
        options.videoConsultations > 100_000)
    )
      throw new BadRequestException(
        'Số lượt video thỏa thuận phải từ 1 đến 100.000.',
      );
    quotas.videoConsultations = options?.videoConsultations ?? 0;
  } else if (
    options?.videoConsultations !== undefined &&
    options.videoConsultations !== quotas.videoConsultations
  ) {
    throw new BadRequestException(
      'Không được tự thay đổi hạn mức video cố định của gói.',
    );
  }

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
      ...(options ||
      carePackage.homeVisitUnitPriceVnd !== undefined ||
      carePackage.videoQuotaPolicy
        ? {
            homeVisitUnitPriceVnd: unitPrice,
            doctorTier: tier,
            doctorSurchargePerVisitVnd: surcharge,
            doctorSurchargeTotalVnd: Number(doctorTotal),
            extraHomeVisits: extraVisits,
            extraHomeVisitsTotalVnd: Number(extraTotal),
            settlementPolicy: 'SERVICE_DAYS_15_85' as const,
          }
        : {}),
    },
    benefits: {
      // Giữ nguyên chu kỳ và ba hạn mức của phiên bản gói, không nhân theo số người/tháng.
      quotaPeriod: carePackage.quotaPeriod,
      quotas,
      ...(carePackage.videoQuotaPolicy
        ? {
            videoQuotaPolicy: carePackage.videoQuotaPolicy,
            videoQuotaConfirmed:
              carePackage.videoQuotaPolicy !== 'CONTRACT' ||
              options?.videoConsultations !== undefined,
          }
        : {}),
      sharedAcrossMembers: true,
    },
  };
}
