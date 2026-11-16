import type { SignerRole } from '@prisma/client';

/** Bốn vai trò bắt buộc phải ký trước khi Documenso đóng dấu toàn bộ tệp PDF. */
export const REQUIRED_SIGNED_ROLES: readonly SignerRole[] = [
  'FAMILY_REP',
  'HEALTHCARE_FACILITY',
  'ASSIGNED_DOCTOR',
  'ADMIN',
];

/** Trạng thái chỉ đạt được sau khi hợp đồng đã hoàn tất đủ 4/4 chữ ký. */
const SIGNED_PDF_UNLOCKED_STATUSES: readonly string[] = [
  'PENDING_PAYMENT',
  'ACTIVE',
];

export interface SignedPdfGateInput {
  documensoItemId?: string | null;
  contractStatus?: string | null;
  signedRoles: Iterable<SignerRole>;
}

/** Kiểm tra hợp đồng đã ghi nhận đủ cả 4 vai trò ký hay chưa. */
export function hasAllFourSignatures(
  signedRoles: Iterable<SignerRole>,
): boolean {
  const roles = new Set<SignerRole>(signedRoles);
  return REQUIRED_SIGNED_ROLES.every((role) => roles.has(role));
}

/**
 * Documenso chỉ đóng dấu toàn bộ chữ ký lên tệp PDF khi cả 4/4 bên ký xong; trước
 * đó bản tải về vẫn là PDF gốc chưa có chữ ký. Chỉ mở khóa khi hợp đồng đã có
 * `documensoItemId` và đủ 4/4 vai trò (hoặc trạng thái đã vượt qua pha ký).
 */
export function isSignedPdfReady(input: SignedPdfGateInput): boolean {
  if (!input.documensoItemId) return false;
  if (
    input.contractStatus &&
    SIGNED_PDF_UNLOCKED_STATUSES.includes(input.contractStatus)
  )
    return true;
  return hasAllFourSignatures(input.signedRoles);
}

/** Đường dẫn proxy nội bộ để tải tệp PDF đã ký của hợp đồng y tế. */
export function buildSignedPdfUrl(contractId: string): string {
  return `/api/v1/contracts/medical/${contractId}/signed-pdf`;
}

/** Trả URL tải PDF đã ký khi hợp đồng đủ điều kiện, ngược lại trả `null`. */
export function resolveSignedPdfUrl(
  contractId: string,
  input: SignedPdfGateInput,
): string | null {
  return isSignedPdfReady(input) ? buildSignedPdfUrl(contractId) : null;
}
