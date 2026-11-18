import { BadRequestException, StreamableFile } from '@nestjs/common';
import type { FacilityLegalDocumentType } from '../services/interfaces/doctors.service.interface';

/**
 * Chuẩn hóa tham số query ?type=operating|business khi xem/tải hồ sơ pháp lý CSYT.
 */
export function parseFacilityDocumentType(
  type?: string,
): FacilityLegalDocumentType {
  if (!type || type === 'operating') return 'operating';
  if (type === 'business') return 'business';
  throw new BadRequestException(
    'Loại tài liệu không hợp lệ (chỉ hỗ trợ operating hoặc business)',
  );
}

/**
 * Chuẩn hoá StreamableFile trả về từ SeaweedFS S3 cho bản scan hồ sơ pháp lý CSYT.
 */
export function createLegalDocumentStream(
  bytes: Buffer,
  contentType: string,
): StreamableFile {
  const extension =
    contentType === 'image/png'
      ? 'png'
      : contentType === 'image/jpeg'
        ? 'jpg'
        : 'pdf';
  return new StreamableFile(bytes, {
    type: contentType,
    disposition: `inline; filename="facility-license.${extension}"`,
  });
}
