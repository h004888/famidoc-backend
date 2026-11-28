import { HttpStatus } from '@nestjs/common';
import {
  EncounterRecordErrorCode,
  ValidationIssue,
} from '../../core/constants/error-codes.constant';
import { BaseApiException } from '../../core/exceptions/api.exception';

export interface DiagnosisInputItem {
  icd10Code: string;
  isPrimary: boolean;
}

export interface Icd10CatalogItem {
  code: string;
  nameVi: string;
  allowedAsPrimary: boolean;
  longTermEligible?: boolean;
}

export interface ResolvedDiagnosisRow {
  icd10Code: string;
  nameSnapshot: string;
  isPrimary: boolean;
  lineNumber: number;
  longTermEligible: boolean;
}

export interface AssertedDiagnosesResult {
  rows: ResolvedDiagnosisRow[];
  primary: ResolvedDiagnosisRow;
}

/**
 * Kiểm tra danh sách chẩn đoán ICD-10 theo quy tắc MS 15/BV1:
 * - Bắt buộc có đúng 1 bệnh chính
 * - Không trùng mã trong cùng trang khám
 * - Mọi mã phải có trong danh mục đang hoạt động
 * - Bệnh chính phải có allowedAsPrimary = true
 */
export function assertDiagnoses(
  input: DiagnosisInputItem[],
  catalog: Icd10CatalogItem[],
): AssertedDiagnosesResult {
  const primaryCount = input.filter((item) => item.isPrimary).length;
  if (primaryCount !== 1) {
    throw new BaseApiException({
      errorCode: EncounterRecordErrorCode.ICD10_PRIMARY_REQUIRED,
      status: HttpStatus.UNPROCESSABLE_ENTITY,
      message: 'Phải chọn đúng 1 bệnh chính trong danh sách chẩn đoán.',
    });
  }

  const seen = new Set<string>();
  const catalogByCode = new Map(
    catalog.map((entry) => [entry.code.trim().toUpperCase(), entry]),
  );

  const rows: ResolvedDiagnosisRow[] = [];
  let primary: ResolvedDiagnosisRow | null = null;

  for (let i = 0; i < input.length; i += 1) {
    const item = input[i];
    const normalizedCode = item.icd10Code.trim().toUpperCase();

    if (seen.has(normalizedCode)) {
      throw new BaseApiException({
        errorCode: EncounterRecordErrorCode.ICD10_DIAGNOSIS_DUPLICATED,
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        message: `Mã ICD-10 ${normalizedCode} bị trùng trong danh sách chẩn đoán.`,
        invalidParams: [
          {
            field: `diagnoses[${i}].icd10Code`,
            issue: ValidationIssue.DUPLICATE,
            message: `Mã ICD-10 ${normalizedCode} đã được chọn trong danh sách.`,
          },
        ],
      });
    }
    seen.add(normalizedCode);

    const entry = catalogByCode.get(normalizedCode);
    if (!entry) {
      throw new BaseApiException({
        errorCode: EncounterRecordErrorCode.ICD10_CODE_NOT_FOUND,
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        message: `Không tìm thấy mã ICD-10 ${normalizedCode} trong danh mục đang hoạt động.`,
        invalidParams: [
          {
            field: `diagnoses[${i}].icd10Code`,
            issue: ValidationIssue.NOT_FOUND,
            message: `Mã ICD-10 ${normalizedCode} không tồn tại hoặc đã ngừng sử dụng.`,
          },
        ],
      });
    }

    if (item.isPrimary && !entry.allowedAsPrimary) {
      const msg = `Mã ${entry.code} chỉ được dùng làm bệnh kèm theo.`;
      throw new BaseApiException({
        errorCode: EncounterRecordErrorCode.ICD10_NOT_ALLOWED_AS_PRIMARY,
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        message: msg,
        invalidParams: [
          {
            field: `diagnoses[${i}].icd10Code`,
            issue: ValidationIssue.INVALID_STATE,
            message: msg,
          },
        ],
      });
    }

    const row: ResolvedDiagnosisRow = {
      icd10Code: entry.code,
      nameSnapshot: entry.nameVi,
      isPrimary: item.isPrimary,
      lineNumber: i,
      longTermEligible: Boolean(entry.longTermEligible),
    };
    rows.push(row);
    if (row.isPrimary) {
      primary = row;
    }
  }

  return {
    rows,
    primary: primary!,
  };
}
