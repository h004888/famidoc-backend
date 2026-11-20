import { BadRequestException } from '@nestjs/common';

export interface ValidatedDocumentFile {
  contentType: 'application/pdf' | 'image/png' | 'image/jpeg';
  extension: 'pdf' | 'png' | 'jpg';
  buffer: Buffer;
}

export const DEFAULT_MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

/**
 * Validates an uploaded document file by size and binary magic bytes (PDF/PNG/JPEG)
 * so spoofed extensions or Content-Type headers cannot bypass verification.
 */
export function validateUploadedDocumentFile(
  file: Pick<Express.Multer.File, 'buffer' | 'size' | 'originalname'> | undefined,
  options?: { maxBytes?: number; label?: string },
): ValidatedDocumentFile {
  const maxBytes = options?.maxBytes ?? DEFAULT_MAX_DOCUMENT_BYTES;
  const label = options?.label ?? 'Tài liệu tải lên';

  if (!file || !file.buffer || file.buffer.length === 0) {
    throw new BadRequestException(`${label} không được để trống.`);
  }

  if (file.buffer.length > maxBytes) {
    const maxMb = Math.round((maxBytes / (1024 * 1024)) * 10) / 10;
    throw new BadRequestException(
      `${label} vượt quá dung lượng tối đa ${maxMb} MB.`,
    );
  }

  const bytes = file.buffer;
  const isPdf = bytes.length >= 5 && bytes.subarray(0, 5).toString('ascii') === '%PDF-';
  const isPng =
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  const isJpeg =
    bytes.length >= 3 && bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'));

  if (isPdf) {
    return { contentType: 'application/pdf', extension: 'pdf', buffer: bytes };
  }
  if (isPng) {
    return { contentType: 'image/png', extension: 'png', buffer: bytes };
  }
  if (isJpeg) {
    return { contentType: 'image/jpeg', extension: 'jpg', buffer: bytes };
  }

  throw new BadRequestException(
    `${label} chỉ chấp nhận tệp hợp lệ định dạng PDF, PNG hoặc JPEG.`,
  );
}
