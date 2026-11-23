import {
  escapeHtml,
  renderCodeCallout,
  renderFamiDocEmailLayout,
  renderKeyValueRows,
  renderNoticeBox,
  resolveAppPublicUrl,
  resolveEmailLogoUrl,
  type EmailTone,
} from '../mailer/templates/famidoc-email-layout';

describe('famidoc-email-layout', () => {
  afterEach(() => {
    delete process.env.APP_PUBLIC_URL;
    delete process.env.EMAIL_LOGO_URL;
  });

  it('escapes XSS payloads across layout fields and section helpers', () => {
    const xss = '<script>alert("xss")</script> & \'quoted\'';
    const bodyHtml = [
      renderCodeCallout({ code: '123456', caption: xss }),
      renderKeyValueRows([{ label: 'Tên <b/>', value: xss, highlight: true }]),
      renderNoticeBox({ title: xss, message: xss, tone: 'warning' }),
    ].join('');

    const html = renderFamiDocEmailLayout({
      preheader: xss,
      badgeLabel: xss,
      tone: 'warning',
      title: xss,
      greeting: `Xin chào ${xss}`,
      intro: xss,
      bodyHtml,
      cta: { label: xss, url: 'https://famidoc.test/?q="><script>' },
      secondaryNote: xss,
    });

    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<svg');
    expect(html).not.toContain('>F+<');
    expect(html).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt; &amp; &#39;quoted&#39;');
    expect(html).toContain('max-width:600px');
    expect(html).toContain('<table role="presentation"');
    expect(html).toContain(
      '<img src="https://famidoc.online/images/logo_khong_chu.png" alt="FamiDoc"',
    );
    expect(html).toContain(
      'Nền tảng quản lý bác sĩ gia đình và chăm sóc sức khỏe',
    );
    expect(html).toContain(
      'FamiDoc - Nền tảng quản lý bác sĩ gia đình và chăm sóc sức khỏe',
    );
    expect(html).toContain('support@famidoc.online');
  });

  it.each<[EmailTone, string]>([
    ['info', '#0037c1'],
    ['action', '#0f3a5d'],
    ['success', '#03864b'],
    ['warning', '#ba1a1a'],
  ])('renders semantic tone %s with expected accent color %s', (tone, accent) => {
    const html = renderFamiDocEmailLayout({
      preheader: 'Tóm tắt kiểm tra tông màu',
      badgeLabel: `Tone ${tone}`,
      tone,
      title: 'Tiêu đề thông báo',
      greeting: 'Xin chào Quý khách,',
      intro: 'Nội dung kiểm tra.',
    });

    expect(html).toContain(accent);
    expect(html).toContain(`Tone ${tone}`);
    expect(html).toContain('Tóm tắt kiểm tra tông màu');
  });

  it('renders CTA and fallback URL when provided and omits them cleanly when absent', () => {
    const withCta = renderFamiDocEmailLayout({
      preheader: 'Có CTA',
      badgeLabel: 'Hành động',
      tone: 'action',
      title: 'Xác nhận',
      greeting: 'Xin chào,',
      intro: 'Vui lòng bấm nút.',
      cta: { label: 'Đăng nhập ngay', url: 'https://app.famidoc.test/login' },
    });

    expect(withCta).toContain('Đăng nhập ngay');
    expect(withCta).toContain('https://app.famidoc.test/login');
    expect(withCta).toContain('sao chép đường dẫn sau');

    const withoutCta = renderFamiDocEmailLayout({
      preheader: 'Không CTA',
      badgeLabel: 'Thông tin',
      tone: 'info',
      title: 'Thông báo',
      greeting: 'Xin chào,',
      intro: 'Không có nút.',
    });

    expect(withoutCta).not.toContain('sao chép đường dẫn sau');
    expect(withoutCta).not.toContain('<a href=');
  });

  it('resolves official logo URL with EMAIL_LOGO_URL, public HTTPS APP_PUBLIC_URL, and fallback', () => {
    expect(resolveEmailLogoUrl()).toBe(
      'https://famidoc.online/images/logo_khong_chu.png',
    );

    process.env.APP_PUBLIC_URL = 'http://localhost:3000';
    expect(resolveEmailLogoUrl()).toBe(
      'https://famidoc.online/images/logo_khong_chu.png',
    );

    process.env.APP_PUBLIC_URL = 'https://famidoc.online/';
    expect(resolveEmailLogoUrl()).toBe(
      'https://famidoc.online/images/logo_khong_chu.png',
    );

    process.env.EMAIL_LOGO_URL = 'https://media.famidoc.online/brand/logo.png';
    expect(resolveEmailLogoUrl()).toBe(
      'https://media.famidoc.online/brand/logo.png',
    );
  });

  it('resolves APP_PUBLIC_URL cleanly and escapes helper strings', () => {
    expect(resolveAppPublicUrl('/login')).toBeUndefined();

    process.env.APP_PUBLIC_URL = 'https://app.famidoc.test///';
    expect(resolveAppPublicUrl('login')).toBe('https://app.famidoc.test/login');
    expect(resolveAppPublicUrl('/booking?queueId=q1')).toBe(
      'https://app.famidoc.test/booking?queueId=q1',
    );
    expect(escapeHtml('A & B')).toBe('A &amp; B');
  });
});
