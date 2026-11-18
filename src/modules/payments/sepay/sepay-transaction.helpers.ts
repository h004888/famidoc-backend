import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomInt } from 'node:crypto';
import type { SePayWebhookDto } from '../dtos/sepay-webhook.dto';

export interface FingerprintTransaction {
  providerTransactionId: string;
  gateway: string;
  accountNumber: string;
  transactionDate: string;
  transferType: 'in' | 'out';
  transferAmount: number;
  code?: string | null;
  content: string;
  referenceCode?: string;
  subAccount?: string | null;
}

const SAFE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const SAFE_DIGITS = '23456789';

export function createPaymentCode(): string {
  // Sinh mã ngẫu nhiên không tuần tự: FD + 8 ký tự an toàn (bỏ 0/O/1/I), bắt buộc có ít nhất 1 chữ số.
  const chars = Array.from(
    { length: 8 },
    () => SAFE_ALPHABET[randomInt(SAFE_ALPHABET.length)],
  );
  if (!chars.some((ch) => SAFE_DIGITS.includes(ch))) {
    chars[randomInt(chars.length)] = SAFE_DIGITS[randomInt(SAFE_DIGITS.length)];
  }
  return 'FD' + chars.join('');
}

export function buildTransferContent(
  name: string | undefined,
  code: string,
): string {
  // Đặt mã FD ở đầu theo mẫu <MA> TT FAMIDOC <TEN> (<= 50 ký tự, không dấu) để không bị cắt đuôi.
  const prefix = `${code} TT FAMIDOC`;
  const normalized = (name ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'D')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Nếu tên tự chứa chuỗi giống mã thanh toán, tách FD ra để không bị hiểu thành hai hóa đơn.
  const maxNameLength = Math.max(0, 50 - prefix.length - 1);
  const displayName = normalized
    .replace(/\bFD(?=[A-Z0-9]+\b)/g, 'F D')
    .slice(0, maxNameLength)
    .trim();
  return displayName ? `${prefix} ${displayName}` : prefix;
}

export function parseSePayDate(value: string): Date {
  // Gắn rõ +07:00, không để giờ server/VPS làm thay đổi thời điểm giao dịch.
  const date = new Date(value.replace(' ', 'T') + '+07:00');
  if (
    !Number.isFinite(date.getTime()) ||
    new Date(date.getTime() + 7 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 19)
      .replace('T', ' ') !== value
  ) {
    throw new BadRequestException('Invalid SePay transactionDate');
  }
  return date;
}

export function extractPaymentCodes(
  dto: Pick<SePayWebhookDto, 'content' | 'code'>,
): string[] {
  // Nhận mã mới FD + 8 ký tự (có ít nhất 1 chữ số), mã FD + 6 chữ số và mã cũ 24/32 hex.
  const codes = new Set<string>();
  const content = dto.content.toUpperCase();
  const pattern =
    /(?:^|[^A-Z0-9])(FD(?:[A-F0-9]{32}|[A-F0-9]{24}|(?=[A-Z0-9]*[0-9])[A-Z0-9]{8}|[0-9]{6}))(?=$|[^A-Z0-9])/g;
  for (const match of content.matchAll(pattern)) codes.add(match[1]);
  const provided = dto.code?.trim().toUpperCase();
  // Khi SePay chỉ trích 24 ký tự từ mã cũ 32 ký tự, dùng mã đầy đủ trong content.
  // Cũng chặn trường hợp mã hợp lệ bị dính thêm chữ/số nhưng SePay vẫn cắt lấy phần đầu.
  const embedded =
    provided && content.includes(provided) && !codes.has(provided);
  if (
    provided &&
    /^FD(?:[A-F0-9]{24}|[A-F0-9]{32}|(?=[A-Z0-9]*[0-9])[A-Z0-9]{8}|[0-9]{6})$/.test(
      provided,
    ) &&
    !embedded
  )
    codes.add(provided);
  // Nếu code và nội dung trỏ hai mã khác nhau thì không tự chọn một mã để kích hoạt.
  return [...codes];
}

export function transactionFingerprint(dto: SePayWebhookDto): string {
  return bankTransactionFingerprint({
    providerTransactionId: String(dto.id),
    gateway: dto.gateway,
    accountNumber: dto.accountNumber,
    transactionDate: dto.transactionDate,
    transferType: dto.transferType,
    transferAmount: dto.transferAmount,
    code: dto.code,
    content: dto.content,
    referenceCode: dto.referenceCode,
    subAccount: dto.subAccount,
  });
}

export function bankTransactionFingerprint(
  dto: FingerprintTransaction,
): string {
  // Không đưa timestamp chữ ký vào fingerprint: mỗi lần retry có thể được ký lại.
  const fields = [
    dto.providerTransactionId,
    dto.gateway.trim().toUpperCase(),
    dto.accountNumber,
    dto.transactionDate,
    dto.transferType,
    dto.transferAmount,
    dto.code ?? null,
    dto.content,
    dto.referenceCode ?? '',
    dto.subAccount ?? '',
  ];
  return createHash('sha256').update(JSON.stringify(fields)).digest('hex');
}
