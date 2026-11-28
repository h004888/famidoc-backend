import { EncounterRecordErrorCode } from '../error-codes.constant';

const EXPECTED_ERROR_CODES = [
  'ICD10_CODE_NOT_FOUND',
  'ICD10_NOT_ALLOWED_AS_PRIMARY',
  'ICD10_DIAGNOSIS_DUPLICATED',
  'ICD10_PRIMARY_REQUIRED',
  'LONG_TERM_PRESCRIPTION_NOT_ELIGIBLE',
  'PRESCRIPTION_DURATION_OUT_OF_RANGE',
  'PRESCRIPTION_REPLACEMENT_INVALID',
  'VISIT_RECORD_LOCKED',
  'VISIT_PRESCRIPTION_ALREADY_ISSUED',
  'PRESCRIPTION_RECIPIENT_INVALID',
  'VISIT_NOT_FOUND',
  'VISIT_NOT_STARTED',
  'VISIT_RECORD_NOT_FINALIZED',
  'ATTENDANCE_PENDING',
  'PRESCRIPTION_NOT_FOUND',
  'PRESCRIPTION_CONCURRENT_UPDATE',
] as const;

describe('EncounterRecordErrorCode', () => {
  it('định nghĩa đúng 16 mã lỗi cho hồ sơ khám và khớp định dạng UPPER_SNAKE_CASE', () => {
    expect(EncounterRecordErrorCode).toBeDefined();

    const entries = Object.entries(EncounterRecordErrorCode);
    expect(entries).toHaveLength(EXPECTED_ERROR_CODES.length);
    expect(Object.keys(EncounterRecordErrorCode).sort()).toEqual(
      [...EXPECTED_ERROR_CODES].sort(),
    );

    for (const [key, value] of entries) {
      expect(value).toBe(key);
      expect(value).toMatch(/^[A-Z0-9_]+$/);
    }
  });
});
