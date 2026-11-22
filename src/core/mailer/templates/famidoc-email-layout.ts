import { resolvePlatformLegalIdentity } from '../../../modules/contracts/templates/platform-legal-identity';

export type EmailTone = 'info' | 'action' | 'success' | 'warning';

export interface FamiDocEmailPayload {
  subject: string;
  text: string;
  html: string;
}

export interface EmailKeyValueRow {
  label: string;
  value: string;
  highlight?: boolean;
}

export interface EmailCtaOptions {
  label: string;
  url: string;
}

export interface FamiDocEmailLayoutParams {
  preheader: string;
  badgeLabel: string;
  tone: EmailTone;
  title: string;
  greeting: string;
  intro: string;
  bodyHtml?: string;
  cta?: EmailCtaOptions;
  secondaryNote?: string;
  signoff?: string;
  supportContact?: string;
}

interface TonePalette {
  headerAccent: string;
  badgeBg: string;
  badgeBorder: string;
  badgeText: string;
  calloutBg: string;
  calloutBorder: string;
  calloutTitle: string;
  ctaBg: string;
  highlightText: string;
}

const TONE_PALETTES: Record<EmailTone, TonePalette> = {
  info: {
    headerAccent: '#0037c1',
    badgeBg: '#eef2ff',
    badgeBorder: '#c7d2fe',
    badgeText: '#0037c1',
    calloutBg: '#f2f3ff',
    calloutBorder: '#c7d2fe',
    calloutTitle: '#00258b',
    ctaBg: '#0037c1',
    highlightText: '#0037c1',
  },
  action: {
    headerAccent: '#0f3a5d',
    badgeBg: '#f0f6fa',
    badgeBorder: '#d0e0ec',
    badgeText: '#0f3a5d',
    calloutBg: '#f0f6fa',
    calloutBorder: '#d0e0ec',
    calloutTitle: '#0f3a5d',
    ctaBg: '#0037c1',
    highlightText: '#0037c1',
  },
  success: {
    headerAccent: '#03864b',
    badgeBg: '#ecfdf5',
    badgeBorder: '#a7f3d0',
    badgeText: '#03864b',
    calloutBg: '#ecfdf5',
    calloutBorder: '#a7f3d0',
    calloutTitle: '#065f46',
    ctaBg: '#03864b',
    highlightText: '#03864b',
  },
  warning: {
    headerAccent: '#ba1a1a',
    badgeBg: '#fef2f2',
    badgeBorder: '#fecaca',
    badgeText: '#ba1a1a',
    calloutBg: '#fef2f2',
    calloutBorder: '#fecaca',
    calloutTitle: '#93000a',
    ctaBg: '#ba1a1a',
    highlightText: '#ba1a1a',
  },
};

const FONT_STACK =
  "'Be Vietnam Pro',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const DEFAULT_EMAIL_LOGO_URL =
  'https://famidoc.online/images/logo_khong_chu.png';
const OFFICIAL_PLATFORM_SUBTITLE =
  'Nền tảng quản lý bác sĩ gia đình và chăm sóc sức khỏe';

/**
 * Resolves the public HTTPS URL for the official FamiDoc icon in transactional emails.
 */
export function resolveEmailLogoUrl(): string {
  const explicitLogoUrl = process.env.EMAIL_LOGO_URL?.trim();
  if (explicitLogoUrl && /^https?:\/\//i.test(explicitLogoUrl)) {
    return explicitLogoUrl;
  }

  const appUrl = process.env.APP_PUBLIC_URL?.trim().replace(/\/+$/, '');
  if (
    appUrl &&
    /^https:\/\//i.test(appUrl) &&
    !/^https:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(appUrl)
  ) {
    return `${appUrl}/images/logo_khong_chu.png`;
  }

  return DEFAULT_EMAIL_LOGO_URL;
}

/**
 * Escapes HTML special characters to prevent markup injection / XSS in email bodies.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Resolves an absolute portal URL from APP_PUBLIC_URL when configured, or returns undefined.
 */
export function resolveAppPublicUrl(path: string): string | undefined {
  const base = process.env.APP_PUBLIC_URL?.trim().replace(/\/+$/, '');
  if (!base) {
    return undefined;
  }
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${base}${normalizedPath}`;
}

/**
 * Renders a structured two-column summary table inside the shared email card.
 */
export function renderKeyValueRows(
  rows: EmailKeyValueRow[],
  tone: EmailTone = 'action',
): string {
  const visibleRows = rows.filter(
    (row) => row.label.trim().length > 0 && row.value.trim().length > 0,
  );
  if (visibleRows.length === 0) {
    return '';
  }

  const palette = TONE_PALETTES[tone];
  const renderedRows = visibleRows
    .map((row, index) => {
      const borderStyle =
        index === visibleRows.length - 1
          ? ''
          : 'border-bottom:1px solid #e2e8f0;';
      const valueColor = row.highlight ? palette.highlightText : '#0f172a';
      const valueSize = row.highlight ? '15px' : '14px';
      const valueWeight = row.highlight ? '700' : '600';
      return `<tr><td style="padding:10px 12px;${borderStyle}color:#475569;font-size:13px;line-height:1.5;vertical-align:top;width:40%;">${escapeHtml(row.label)}</td><td style="padding:10px 12px;${borderStyle}color:${valueColor};font-size:${valueSize};font-weight:${valueWeight};line-height:1.5;vertical-align:top;word-break:break-word;">${escapeHtml(row.value)}</td></tr>`;
    })
    .join('');

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:16px 0;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;">${renderedRows}</table>`;
}

/**
 * Renders a prominent centered verification code / OTP callout box.
 */
export function renderCodeCallout(params: {
  code: string;
  caption?: string;
  tone?: EmailTone;
}): string {
  const palette = TONE_PALETTES[params.tone ?? 'info'];
  const captionHtml = params.caption
    ? `<div style="margin-top:8px;font-size:12px;line-height:1.5;color:#475569;">${escapeHtml(params.caption)}</div>`
    : '';

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:18px 0;"><tr><td align="center" style="padding:18px 16px;background:${palette.calloutBg};border:1px solid ${palette.calloutBorder};border-radius:12px;text-align:center;"><div style="font-size:30px;font-weight:700;letter-spacing:8px;line-height:1.2;color:${palette.calloutTitle};">${escapeHtml(params.code)}</div>${captionHtml}</td></tr></table>`;
}

/**
 * Renders a contextual notice / rejection reason / security guidance callout box.
 */
export function renderNoticeBox(params: {
  title?: string;
  message: string;
  tone?: EmailTone;
}): string {
  const palette = TONE_PALETTES[params.tone ?? 'info'];
  const titleHtml = params.title
    ? `<div style="margin:0 0 6px;font-size:13px;font-weight:700;line-height:1.4;color:${palette.calloutTitle};">${escapeHtml(params.title)}</div>`
    : '';
  const escapedMessage = escapeHtml(params.message).replace(/\r?\n/g, '<br />');

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:16px 0;"><tr><td style="padding:14px 16px;background:${palette.calloutBg};border:1px solid ${palette.calloutBorder};border-left:4px solid ${palette.headerAccent};border-radius:8px;font-size:13px;line-height:1.6;color:#1e293b;">${titleHtml}<div>${escapedMessage}</div></td></tr></table>`;
}

/**
 * Renders the shared table-based 600px FamiDoc transactional HTML email shell.
 */
export function renderFamiDocEmailLayout(
  params: FamiDocEmailLayoutParams,
): string {
  const palette = TONE_PALETTES[params.tone];
  const legal = resolvePlatformLegalIdentity();
  const logoUrl = resolveEmailLogoUrl();
  const supportContact = (
    params.supportContact?.trim() ||
    legal.supportContact ||
    'support@famidoc.online'
  ).trim();
  const signoff = (params.signoff?.trim() || 'Đội ngũ FamiDoc').trim();

  const ctaUrl = params.cta?.url?.trim();
  const ctaHtml =
    params.cta && ctaUrl
      ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0 8px;border-collapse:collapse;"><tr><td align="center" bgcolor="${palette.ctaBg}" style="background:${palette.ctaBg};border-radius:10px;"><a href="${escapeHtml(ctaUrl)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:12px 22px;font-family:${FONT_STACK};font-size:14px;font-weight:700;line-height:1.4;color:#ffffff;text-decoration:none;border-radius:10px;">${escapeHtml(params.cta.label)}</a></td></tr></table><p style="margin:10px 0 0;font-size:12px;line-height:1.6;color:#64748b;">Nếu nút trên không mở được, hãy sao chép đường dẫn sau vào trình duyệt:<br /><span style="color:#334155;word-break:break-all;">${escapeHtml(ctaUrl)}</span></p>`
      : '';

  const secondaryNoteHtml = params.secondaryNote?.trim()
    ? `<p style="margin:16px 0 0;font-size:12px;line-height:1.6;color:#64748b;">${escapeHtml(params.secondaryNote.trim())}</p>`
    : '';

  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="color-scheme" content="light" />
<meta name="supported-color-schemes" content="light" />
<title>${escapeHtml(params.title)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f5f6f8;font-family:${FONT_STACK};color:#0f172a;-webkit-font-smoothing:antialiased;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:#f5f6f8;">${escapeHtml(params.preheader)}&#847;&zwnj;&nbsp;&#8199;&shy;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f5f6f8" style="width:100%;background-color:#f5f6f8;border-collapse:collapse;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background-color:#ffffff;border:1px solid #e2e8f0;border-radius:16px;border-collapse:separate;overflow:hidden;">
<tr><td style="height:4px;background-color:${palette.headerAccent};font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td style="padding:20px 28px 16px;border-bottom:1px solid #e2e8f0;background-color:#ffffff;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">
<tr>
<td valign="middle" style="vertical-align:middle;">
<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
<tr>
<td align="center" valign="middle" width="44" height="44" style="width:44px;height:44px;vertical-align:middle;">
<img src="${escapeHtml(logoUrl)}" alt="FamiDoc" width="44" height="44" style="display:block;width:44px;height:44px;border:0;outline:none;text-decoration:none;border-radius:10px;" />
</td>
<td style="padding-left:12px;vertical-align:middle;">
<div style="font-size:17px;font-weight:700;line-height:1.2;color:#0f3a5d;">FamiDoc</div>
<div style="font-size:11px;font-weight:500;line-height:1.35;color:#64748b;">${escapeHtml(OFFICIAL_PLATFORM_SUBTITLE)}</div>
</td>
</tr>
</table>
</td>
<td align="right" valign="middle" style="vertical-align:middle;text-align:right;">
<span style="display:inline-block;padding:4px 10px;background-color:${palette.badgeBg};border:1px solid ${palette.badgeBorder};border-radius:999px;font-size:11px;font-weight:700;line-height:1.3;color:${palette.badgeText};white-space:nowrap;">${escapeHtml(params.badgeLabel)}</span>
</td>
</tr>
</table>
</td></tr>
<tr><td style="padding:24px 28px;background-color:#ffffff;">
<h1 style="margin:0 0 14px;font-size:19px;font-weight:700;line-height:1.35;color:#0f172a;">${escapeHtml(params.title)}</h1>
<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#334155;">${escapeHtml(params.greeting)}</p>
<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#334155;">${escapeHtml(params.intro)}</p>
${params.bodyHtml ?? ''}
${ctaHtml}
${secondaryNoteHtml}
<p style="margin:22px 0 0;font-size:13px;line-height:1.6;color:#475569;">Trân trọng,<br /><strong style="color:#0f172a;">${escapeHtml(signoff)}</strong></p>
</td></tr>
<tr><td style="padding:16px 28px 20px;background-color:#f8fafc;border-top:1px solid #e2e8f0;font-size:12px;line-height:1.6;color:#64748b;">
<div style="font-weight:600;color:#475569;">${escapeHtml(legal.companyName)}</div>
<div>Hỗ trợ: <span style="color:#0f3a5d;">${escapeHtml(supportContact)}</span></div>
<div style="margin-top:4px;color:#94a3b8;">Email này được gửi tự động từ hệ thống FamiDoc, vui lòng không phản hồi trực tiếp.</div>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}
