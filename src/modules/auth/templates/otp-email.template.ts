import {
  renderCodeCallout,
  renderFamiDocEmailLayout,
  renderNoticeBox,
} from '../../../core/mailer/templates/famidoc-email-layout';

export interface OtpEmailContent {
  subject: string;
  text: string;
  html: string;
}

export function buildRegistrationOtpEmail(params: {
  fullName: string;
  otp: string;
  expiresInMinutes?: number;
}): OtpEmailContent {
  const expiresMinutes = params.expiresInMinutes ?? 5;
  const safeName = params.fullName.trim() || 'Quý khách';

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

  const html = renderFamiDocEmailLayout({
    preheader: `Mã xác thực OTP đăng ký tài khoản FamiDoc của bạn là ${params.otp} (hiệu lực ${expiresMinutes} phút).`,
    badgeLabel: 'Xác thực tài khoản',
    tone: 'info',
    title: 'Xác thực đăng ký tài khoản FamiDoc',
    greeting: `Xin chào ${safeName},`,
    intro:
      'Vui lòng nhập mã xác thực OTP dưới đây để hoàn tất kích hoạt tài khoản đại diện gia đình của bạn:',
    bodyHtml: [
      renderCodeCallout({
        code: params.otp,
        caption: `Mã có hiệu lực trong ${expiresMinutes} phút`,
        tone: 'info',
      }),
      renderNoticeBox({
        title: 'Lưu ý bảo mật',
        message: `Mã có hiệu lực trong ${expiresMinutes} phút. Tuyệt đối không chia sẻ mã này cho bất kỳ ai.`,
        tone: 'info',
      }),
    ].join(''),
    secondaryNote:
      'Nếu bạn không thực hiện yêu cầu đăng ký này, vui lòng bỏ qua email.',
  });

  return { subject, text, html };
}

export function buildPasswordResetOtpEmail(params: {
  otp: string;
  expiresInMinutes?: number;
}): OtpEmailContent {
  const expiresMinutes = params.expiresInMinutes ?? 10;

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

  const html = renderFamiDocEmailLayout({
    preheader: `Mã OTP đặt lại mật khẩu tài khoản FamiDoc có hiệu lực trong ${expiresMinutes} phút.`,
    badgeLabel: 'Khôi phục mật khẩu',
    tone: 'info',
    title: 'Khôi phục mật khẩu FamiDoc',
    greeting: 'Xin chào,',
    intro:
      'Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản FamiDoc của bạn. Mã OTP xác thực là:',
    bodyHtml: [
      renderCodeCallout({
        code: params.otp,
        caption: `Mã có hiệu lực trong ${expiresMinutes} phút`,
        tone: 'info',
      }),
      renderNoticeBox({
        title: 'Lưu ý bảo mật',
        message: `Mã có hiệu lực trong ${expiresMinutes} phút. Vui lòng không chia sẻ mã này cho bất kỳ ai.`,
        tone: 'info',
      }),
    ].join(''),
    secondaryNote:
      'Nếu bạn không thực hiện yêu cầu đặt lại mật khẩu này, vui lòng bỏ qua email.',
  });

  return { subject, text, html };
}
