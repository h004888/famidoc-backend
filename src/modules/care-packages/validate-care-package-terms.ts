import { BadRequestException } from '@nestjs/common';
import type { CarePackageTerms } from './entities/care-package.entity';

export function validateCarePackageTerms(terms: CarePackageTerms): void {
  // DTO kiểm tra từng trường; hàm này kiểm tra quan hệ nghiệp vụ giữa các trường.
  // Số người tối đa không thể thấp hơn số người đã nằm trong giá gói cơ bản.
  if (terms.maxMembers < terms.includedMembers) {
    throw new BadRequestException('maxMembers cannot be below includedMembers');
  }
  // Không cho thêm thành viên thì cũng không được cấu hình phí thêm thành viên.
  if (
    terms.maxMembers === terms.includedMembers &&
    terms.additionalMemberMonthlyPriceVnd !== 0
  ) {
    throw new BadRequestException(
      'Additional-member fee must be zero when extra members are disabled',
    );
  }
  if (
    terms.homeVisitUnitPriceVnd !== undefined &&
    terms.homeVisitUnitPriceVnd * terms.quotas.homeVisits !== terms.priceVnd
  ) {
    throw new BadRequestException(
      'Giá gói cơ bản phải bằng số lần khám tại nhà nhân đơn giá; phụ thu bác sĩ tính riêng.',
    );
  }
  if (terms.videoQuotaPolicy === 'CONTRACT' && terms.durationMonths !== 12) {
    throw new BadRequestException(
      'Chỉ gói năm dùng hạn mức video chốt theo hợp đồng.',
    );
  }
  // Một gói phải có ít nhất một quyền lợi khám/tư vấn, không công bố gói rỗng quyền lợi.
  if (Object.values(terms.quotas).every((quota) => quota === 0)) {
    throw new BadRequestException(
      'A package must include at least one consultation or visit',
    );
  }
}
