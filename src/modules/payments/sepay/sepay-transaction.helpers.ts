import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { SePayWebhookDto } from '../dtos/sepay-webhook.dto';

export function createPaymentCode(number: number): string {
  if (!Number.isSafeInteger(number) || number < 1 || number > 999999)
    throw new ServiceUnavailableException(
      'Six-digit payment codes exhausted; extend the code format before accepting more payments',
    );
  // DB cấp số tăng dần cho từng lần thanh toán, kể cả khi nhiều server cùng tạo QR.
  // Không dùng mã cố định theo tài khoản vì một gia đình có thể trả nhiều hóa đơn.
  return 'FD' + String(number).padStart(6, '0');
}

export function buildTransferContent(
  name: string | undefined,
  code: string,
): string {
  // App ngân hàng dùng tên không dấu; mã FD luôn giữ nguyên ở cuối, không bị cắt cùng tên dài.
  const normalized = (name ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'D')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Nếu tên tự chứa chuỗi giống mã thanh toán, tách FD ra để không bị hiểu thành hai hóa đơn.
  const displayName = normalized
    .replace(/\bFD(?=[A-Z0-9]+\b)/g, 'F D')
    .slice(0, 36)
    .trim();
  return displayName ? `${displayName} - ${code}` : code;
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

export function extractPaymentCodes(dto: SePayWebhookDto): string[] {
  // Nhận mã mới FD + 6 chữ số và mã cũ 24/32 ký tự; phải là mã trọn vẹn trong nội dung.
  const codes = new Set<string>();
  const content = dto.content.toUpperCase();
  const pattern =
    /(?:^|[^A-Z0-9])(FD(?:[A-F0-9]{32}|[A-F0-9]{24}|[0-9]{6}))(?=$|[^A-Z0-9])/g;
  for (const match of content.matchAll(pattern)) codes.add(match[1]);
  const provided = dto.code?.trim().toUpperCase();
  // Khi SePay chỉ trích 24 ký tự từ mã cũ 32 ký tự, dùng mã đầy đủ trong content.
  // Cũng chặn trường hợp mã hợp lệ bị dính thêm chữ/số nhưng SePay vẫn cắt lấy phần đầu.
  const embedded =
    provided && content.includes(provided) && !codes.has(provided);
  if (
    provided &&
    /^FD(?:[A-F0-9]{24}|[A-F0-9]{32}|[0-9]{6})$/.test(provided) &&
    !embedded
  )
    codes.add(provided);
  // Nếu code và nội dung trỏ hai mã khác nhau thì không tự chọn một mã để kích hoạt.
  return [...codes];
}

export function transactionFingerprint(dto: SePayWebhookDto): string {
  // Không đưa timestamp chữ ký vào fingerprint: mỗi lần retry có thể được ký lại.
  const fields = [
    dto.id,
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
