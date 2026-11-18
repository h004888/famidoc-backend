const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const VN_PHONE_REGEX =
  /(?:\+?84|0)(?:[\s.-]*\d){8,10}\b/g;
const CCCD_REGEX = /\b\d{9,12}\b/g;
const HOUSE_NUMBER_REGEX =
  /\b(?:số\s*nhà|số)\s*\d+[a-zA-Z0-9/-]*\b/gi;

/**
 * Khử thông tin định danh cá nhân (SĐT, email, CCCD, số nhà) trước khi gửi
 * dữ liệu sang dịch vụ ngoài (TypeSafe Jev) hoặc lưu trữ vết matching.
 */
export function sanitizeMatchingText(input?: string | null): string {
  if (!input) return '';
  return input
    .replace(EMAIL_REGEX, '[EMAIL_REDACTED]')
    .replace(VN_PHONE_REGEX, '[PHONE_REDACTED]')
    .replace(CCCD_REGEX, '[ID_REDACTED]')
    .replace(HOUSE_NUMBER_REGEX, '[ADDRESS_REDACTED]')
    .replace(/\s+/g, ' ')
    .trim();
}
