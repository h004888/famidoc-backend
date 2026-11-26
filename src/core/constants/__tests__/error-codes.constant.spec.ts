import {
  SystemErrorCode,
  AuthErrorCode,
  ValidationErrorCode,
  ValidationIssue,
  ContractErrorCode,
  DoctorErrorCode,
  CarePackageErrorCode,
  PaymentErrorCode,
} from '../error-codes.constant';

describe('Error Codes and Problem Details URI Constants', () => {
  it('tất cả các mã lỗi phải là chuỗi không rỗng và theo định dạng UPPER_SNAKE_CASE', () => {
    const allCodes = [
      ...Object.values(SystemErrorCode),
      ...Object.values(AuthErrorCode),
      ...Object.values(ValidationErrorCode),
      ...Object.values(ContractErrorCode),
      ...Object.values(DoctorErrorCode),
      ...Object.values(CarePackageErrorCode),
      ...Object.values(PaymentErrorCode),
    ];

    expect(allCodes.length).toBeGreaterThan(0);
    const upperSnakeCaseRegex = /^[A-Z0-9]+(_[A-Z0-9]+)*$/;
    for (const code of allCodes) {
      expect(typeof code).toBe('string');
      expect(code.length).toBeGreaterThan(0);
      expect(code).toMatch(upperSnakeCaseRegex);
    }
  });

  it('không được có mã lỗi bị trùng lặp giữa các enum', () => {
    const allCodes = [
      ...Object.values(SystemErrorCode),
      ...Object.values(AuthErrorCode),
      ...Object.values(ValidationErrorCode),
      ...Object.values(ContractErrorCode),
      ...Object.values(DoctorErrorCode),
      ...Object.values(CarePackageErrorCode),
      ...Object.values(PaymentErrorCode),
    ];

    const uniqueCodes = new Set(allCodes);
    expect(uniqueCodes.size).toBe(allCodes.length);
  });

  it('ValidationIssue phải định nghĩa đầy đủ các chuẩn vi phạm dữ liệu', () => {
    expect(ValidationIssue.REQUIRED).toBe('REQUIRED');
    expect(ValidationIssue.INVALID_FORMAT).toBe('INVALID_FORMAT');
    expect(ValidationIssue.MIN_VALUE).toBe('MIN_VALUE');
    expect(ValidationIssue.MAX_VALUE).toBe('MAX_VALUE');
    expect(ValidationIssue.INVALID_TYPE).toBe('INVALID_TYPE');
  });

  it('CarePackageErrorCode không còn chứa CARE_PACKAGE_RISK_ACK_REQUIRED', () => {
    expect(Object.values(CarePackageErrorCode)).not.toContain('CARE_PACKAGE_RISK_ACK_REQUIRED');
  });
});
