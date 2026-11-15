export interface OtpEmailContent {
  subject: string;
  text: string;
  html: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildRegistrationOtpEmail(params: {
  fullName: string;
  otp: string;
  expiresInMinutes?: number;
}): OtpEmailContent {
  const expiresMinutes = params.expiresInMinutes ?? 5;
  const safeName = params.fullName.trim() || 'Quý khách';
  const escapedName = escapeHtml(safeName);
  const escapedOtp = escapeHtml(params.otp);

  const subject = 'FamiDoc - Mã xác thực OTP đăng ký tài khoản';
  const text = [
    `Xin chào ${safeName},`,
    '',
    `Mã xác thực OTP đăng ký tài khoản đại diện gia đình FamiDoc của bạn là: ${params.otp}`,
    `Mã có hiệu lực trong ${expiresMinutes} phút. Vui lòng không chia sẻ mã này cho bất kỳ ai.`,
    '',
    'Nếu bạn không thực hiện yêu cầu đăng ký này, vui lòng bỏ qua email.',
    '',
    'Trân trọng,',
    'Đội ngũ FamiDoc',
  ].join('\n');

  const html = `<!doctype html>
<html lang="vi">
  <body style="margin:0;padding:24px;background:#f8fafc;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;padding:28px;">
      <h1 style="margin:0 0 12px;font-size:18px;color:#2E37A4;">Xác thực đăng ký tài khoản FamiDoc</h1>
      <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#334155;">
        Xin chào <strong>${escapedName}</strong>, vui lòng nhập mã xác thực OTP dưới đây để hoàn tất kích hoạt tài khoản đại diện gia đình của bạn:
      </p>
      <div style="margin:20px 0;padding:16px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;text-align:center;">
        <span style="font-size:28px;font-weight:700;letter-spacing:6px;color:#1e3a8a;">${escapedOtp}</span>
      </div>
      <p style="margin:0 0 12px;font-size:13px;line-height:1.6;color:#475569;">
        Mã có hiệu lực trong <strong>${expiresMinutes} phút</strong>. Tuyệt đối không chia sẻ mã này cho bất kỳ ai.
      </p>
      <p style="margin:0 0 20px;font-size:12px;line-height:1.6;color:#64748b;">
        Nếu bạn không thực hiện yêu cầu đăng ký này, vui lòng bỏ qua email.
      </p>
      <p style="margin:0;font-size:12px;color:#94a3b8;">Trân trọng, Đội ngũ FamiDoc</p>
    </div>
  </body>
</html>`;

  return { subject, text, html };
}

export function buildPasswordResetOtpEmail(params: {
  otp: string;
  expiresInMinutes?: number;
}): OtpEmailContent {
  const expiresMinutes = params.expiresInMinutes ?? 10;
  const escapedOtp = escapeHtml(params.otp);

  const subject = 'FamiDoc - Mã xác thực đặt lại mật khẩu';
  const text = [
    'Xin chào,',
    '',
    `Mã OTP đặt lại mật khẩu tài khoản FamiDoc của bạn là: ${params.otp}`,
    `Mã có hiệu lực trong ${expiresMinutes} phút. Vui lòng không chia sẻ mã này cho bất kỳ ai.`,
    '',
    'Trân trọng,',
    'Đội ngũ FamiDoc',
  ].join('\n');

  const html = `<!doctype html>
<html lang="vi">
  <body style="margin:0;padding:24px;background:#f8fafc;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;padding:28px;">
      <h1 style="margin:0 0 12px;font-size:18px;color:#2E37A4;">Khôi phục mật khẩu FamiDoc</h1>
      <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#334155;">
        Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản FamiDoc của bạn. Mã OTP xác thực là:
      </p>
      <div style="margin:20px 0;padding:16px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;text-align:center;">
        <span style="font-size:28px;font-weight:700;letter-spacing:6px;color:#1e3a8a;">${escapedOtp}</span>
      </div>
      <p style="margin:0 0 12px;font-size:13px;line-height:1.6;color:#475569;">
        Mã có hiệu lực trong <strong>${expiresMinutes} phút</strong>. Vui lòng không chia sẻ mã này cho bất kỳ ai.
      </p>
      <p style="margin:0;font-size:12px;color:#94a3b8;">Trân trọng, Đội ngũ FamiDoc</p>
    </div>
  </body>
</html>`;

  return { subject, text, html };
}
