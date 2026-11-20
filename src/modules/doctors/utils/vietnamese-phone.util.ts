export const VN_MOBILE_PHONE_REGEX = /^(0[35789][0-9]{8})$/;

export function normalizeVietnameseMobilePhone(raw: string): string {
  const cleaned = raw.replace(/[\s.\-()]/g, '').trim();
  if (!cleaned) return '';

  if (/^\+84[35789][0-9]{8}$/.test(cleaned)) {
    return `0${cleaned.slice(3)}`;
  }
  if (/^84[35789][0-9]{8}$/.test(cleaned)) {
    return `0${cleaned.slice(2)}`;
  }
  if (/^[35789][0-9]{8}$/.test(cleaned)) {
    return `0${cleaned}`;
  }
  return cleaned;
}

export function getVietnamesePhoneVariants(phone: string): string[] {
  const normalized = normalizeVietnameseMobilePhone(phone);
  if (!VN_MOBILE_PHONE_REGEX.test(normalized)) {
    return [phone.trim()].filter(Boolean);
  }
  const withoutZero = normalized.slice(1);
  return Array.from(
    new Set([normalized, `84${withoutZero}`, `+84${withoutZero}`, withoutZero]),
  );
}
