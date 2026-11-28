import { Icd10DaggerAsterisk, Prisma } from '@prisma/client';
import { eligibleForLongTermPrescription } from '../encounters/prescription-rules';

const ICD10_CODE_REGEX = /^[A-Z]\d{2}(\.\d{1,4})?$/;
const SECONDARY_ONLY_GROUP_REGEX = /^B9[5-7](\.|$)/;
const VALID_DAGGER_ASTERISK = new Set<string>(
  Object.values(Icd10DaggerAsterisk),
);

export interface Icd10Row {
  code: string;
  nameVi: string;
  nameEn: string | null;
  chapter: string;
  daggerAsterisk: Icd10DaggerAsterisk;
}

export interface Icd10CsvError {
  line: number;
  raw: string;
  reason: string;
}

export interface ParseIcd10CsvResult {
  rows: Icd10Row[];
  errors: Icd10CsvError[];
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];

    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }

  fields.push(current);
  return fields;
}

export function parseIcd10Csv(text: string): ParseIcd10CsvResult {
  const normalizedText = text.replace(/^\uFEFF/, '');
  const lines = normalizedText.split(/\r?\n/);
  const rows: Icd10Row[] = [];
  const errors: Icd10CsvError[] = [];

  for (let idx = 0; idx < lines.length; idx += 1) {
    const raw = lines[idx];
    if (!raw.trim()) continue;

    const cols = parseCsvLine(raw);
    const firstCol = (cols[0] ?? '').trim();

    if (idx === 0 && firstCol.toLowerCase() === 'code') {
      continue;
    }

    if (cols.length < 5) {
      errors.push({
        line: idx + 1,
        raw,
        reason: 'Thiếu cột dữ liệu (cần đủ 5 cột)',
      });
      continue;
    }

    const code = firstCol.toUpperCase();
    if (!ICD10_CODE_REGEX.test(code)) {
      errors.push({
        line: idx + 1,
        raw,
        reason: `Mã ICD-10 không hợp lệ: "${firstCol}"`,
      });
      continue;
    }

    const nameVi = (cols[1] ?? '').trim();
    const nameEnRaw = (cols[2] ?? '').trim();
    const chapter = (cols[3] ?? '').trim();
    const daggerRaw = (cols[4] ?? '').trim().toUpperCase() || 'NONE';

    if (!nameVi || !chapter) {
      errors.push({
        line: idx + 1,
        raw,
        reason: 'Thiếu tên tiếng Việt hoặc chương ICD-10',
      });
      continue;
    }

    if (!VALID_DAGGER_ASTERISK.has(daggerRaw)) {
      errors.push({
        line: idx + 1,
        raw,
        reason: `Giá trị daggerAsterisk không hợp lệ: "${daggerRaw}"`,
      });
      continue;
    }

    rows.push({
      code,
      nameVi,
      nameEn: nameEnRaw || null,
      chapter,
      daggerAsterisk: daggerRaw as Icd10DaggerAsterisk,
    });
  }

  return { rows, errors };
}

export function toIcd10Record(row: Icd10Row): Prisma.Icd10CodeCreateInput {
  const code = row.code.trim().toUpperCase();
  const allowedAsPrimary =
    row.daggerAsterisk !== Icd10DaggerAsterisk.ASTERISK &&
    !SECONDARY_ONLY_GROUP_REGEX.test(code);

  return {
    code,
    nameVi: row.nameVi.trim(),
    nameEn: row.nameEn ? row.nameEn.trim() : null,
    chapter: row.chapter.trim(),
    daggerAsterisk: row.daggerAsterisk,
    allowedAsPrimary,
    longTermEligible: eligibleForLongTermPrescription(code),
    isActive: true,
  };
}
