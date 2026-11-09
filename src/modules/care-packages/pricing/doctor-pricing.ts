import { BadRequestException } from '@nestjs/common';

export enum DoctorTier {
  STANDARD = 'STANDARD',
  MASTER = 'MASTER',
  DOCTORATE = 'DOCTORATE',
  PROFESSOR = 'PROFESSOR',
}

export const doctorSurcharges: Record<DoctorTier, number> = {
  STANDARD: 0,
  MASTER: 50_000,
  DOCTORATE: 100_000,
  PROFESSOR: 200_000,
};

// CSYT đã khai báo học hàm/học vị của bác sĩ. Không lấy đơn giá do khách gửi lên.
export function resolveDoctorTier(
  title: string | null | undefined,
): DoctorTier {
  const value = (title ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toUpperCase()
    .replace(/[.\s_-]/g, '');
  if (
    !value ||
    [
      'BS',
      'BACSI',
      'STANDARD',
      'GENERAL',
      'BACSITHUONG',
      'GENERALPRACTITIONER',
      'BSCKI',
      'BSCKII',
    ].includes(value)
  )
    return DoctorTier.STANDARD;
  if (/PROFESSOR|GIAOSU|PGS|^GS/.test(value)) return DoctorTier.PROFESSOR;
  if (/DOCTORATE|TIENSI|PHD|^TS/.test(value)) return DoctorTier.DOCTORATE;
  if (/MASTER|THACSI|THS|MSC/.test(value)) return DoctorTier.MASTER;
  throw new BadRequestException(
    'CSYT cần chuẩn hóa academicTitle của bác sĩ trước khi báo giá.',
  );
}

export interface QuoteOptions {
  doctorTier?: DoctorTier;
  extraHomeVisits?: number;
  videoConsultations?: number;
}
