import { HttpStatus } from '@nestjs/common';
import { BaseApiException } from '../../core/exceptions/api.exception';
import { CarePackageErrorCode } from '../../core/constants/error-codes.constant';
import type { CarePackageTerms } from './entities/care-package.entity';
import {
  assertNoBlockingFindings,
  evaluateCarePackageRules,
} from './rules/care-package-rules';

export function validateCarePackageTerms(terms: CarePackageTerms): void {
  // DTO kiểm tra từng trường; hàm này kiểm tra quan hệ nghiệp vụ giữa các trường.
  // R1: Số người tối đa không thể thấp hơn số người đã nằm trong giá gói cơ bản.
  if (terms.maxMembers < terms.includedMembers) {
    throw new BaseApiException({
      errorCode: CarePackageErrorCode.CARE_PACKAGE_TERMS_INVALID,
      status: HttpStatus.BAD_REQUEST,
      message: 'Số thành viên tối đa phải lớn hơn hoặc bằng số thành viên trong giá gói.',
      invalidParams: [
        {
          field: 'maxMembers',
          issue: 'MIN_VALUE',
          message: 'Số thành viên tối đa phải lớn hơn hoặc bằng số thành viên trong giá gói.',
        },
      ],
    });
  }
  // R2: Không cho thêm thành viên thì cũng không được cấu hình phí thêm thành viên.
  if (
    terms.maxMembers === terms.includedMembers &&
    terms.additionalMemberMonthlyPriceVnd !== 0
  ) {
    throw new BaseApiException({
      errorCode: CarePackageErrorCode.CARE_PACKAGE_TERMS_INVALID,
      status: HttpStatus.BAD_REQUEST,
      message: 'Phụ phí thêm thành viên phải bằng 0đ khi gói không cho phép thêm thành viên.',
      invalidParams: [
        {
          field: 'additionalMemberMonthlyPriceVnd',
          issue: 'MAX_VALUE',
          message: 'Phụ phí thêm thành viên phải bằng 0đ khi gói không cho phép thêm thành viên.',
        },
      ],
    });
  }
  // R3: Nếu có đơn giá khám tại nhà thì giá gói phải khớp đơn giá * số lượt khám tại nhà.
  if (
    terms.homeVisitUnitPriceVnd !== undefined &&
    terms.homeVisitUnitPriceVnd * terms.quotas.homeVisits !== terms.priceVnd
  ) {
    throw new BaseApiException({
      errorCode: CarePackageErrorCode.CARE_PACKAGE_TERMS_INVALID,
      status: HttpStatus.BAD_REQUEST,
      message: 'Giá gói trọn kỳ phải bằng đơn giá khám tại nhà nhân với số lượt khám tại nhà.',
      invalidParams: [
        {
          field: 'priceVnd',
          issue: 'INVALID_VALUE',
          message: 'Giá gói trọn kỳ phải bằng đơn giá khám tại nhà nhân với số lượt khám tại nhà.',
        },
      ],
    });
  }
  // Năng lực xếp lịch (S1/S6) và điều kiện lượt khám (P3, videoConsultations >= 1).
  assertNoBlockingFindings(evaluateCarePackageRules(terms));
}
