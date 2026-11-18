import { DoctorClinicalTier } from '@prisma/client';

const SENIOR_TITLE_REGEX =
  /\b(PGS|GS|TS|CKII|CK2)\b|Tiến sĩ|Chuyên khoa II|Phó giáo sư|Giáo sư/i;
const INTERMEDIATE_TITLE_REGEX =
  /\b(ThS|CKI|CK1)\b|Thạc sĩ|Chuyên khoa I/i;

/**
 * Suy luận phân hạng bác sĩ (JUNIOR / STANDARD / SENIOR) từ số năm kinh nghiệm
 * và học hàm/học vị để phục vụ backfill và hiển thị Dual-Track.
 */
export function inferDoctorClinicalTier(
  experienceYears: number,
  academicTitle?: string | null,
): DoctorClinicalTier {
  const title = (academicTitle ?? '').trim();
  const years = Number.isFinite(experienceYears) ? experienceYears : 0;

  if (years >= 12 || SENIOR_TITLE_REGEX.test(title)) {
    return DoctorClinicalTier.SENIOR;
  }

  if (years < 5 && !INTERMEDIATE_TITLE_REGEX.test(title)) {
    return DoctorClinicalTier.JUNIOR;
  }

  return DoctorClinicalTier.STANDARD;
}
