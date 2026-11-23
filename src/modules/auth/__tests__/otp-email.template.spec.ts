import {
  buildPasswordResetOtpEmail,
  buildRegistrationOtpEmail,
} from '../templates/otp-email.template';

describe('otp-email.template', () => {
  it('tạo email OTP đăng ký có đủ subject, preheader, layout chung, OTP callout và escape HTML an toàn', () => {
    const email = buildRegistrationOtpEmail({
      fullName: 'Nguyễn <script>alert(1)</script> An',
      otp: '654321',
      expiresInMinutes: 5,
    });

    expect(email.subject).toBe('FamiDoc - Mã xác thực OTP đăng ký tài khoản');
    expect(email.text).toContain('654321');
    expect(email.text).toContain('5 phút');
    expect(email.html).toContain('654321');
    expect(email.html).toContain('5 phút');
    expect(email.html).toContain('FamiDoc');
    expect(email.html).toContain('Xác thực tài khoản');
    expect(email.html).toContain('support@famidoc.online');
    expect(email.html).toContain('#0037c1');
    expect(email.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(email.html).not.toContain('<script>');
    expect(email.html).not.toContain('#2E37A4');
  });

  it('mặc định tên Quý khách khi fullName trống', () => {
    const email = buildRegistrationOtpEmail({
      fullName: '   ',
      otp: '999888',
    });

    expect(email.text).toContain('Xin chào Quý khách,');
    expect(email.html).toContain('Xin chào Quý khách,');
  });

  it('tạo email OTP khôi phục mật khẩu có đủ subject, text và html dùng layout chung', () => {
    const email = buildPasswordResetOtpEmail({ otp: '112233', expiresInMinutes: 10 });

    expect(email.subject).toBe('FamiDoc - Mã xác thực đặt lại mật khẩu');
    expect(email.text).toContain('112233');
    expect(email.html).toContain('112233');
    expect(email.html).toContain('10 phút');
    expect(email.html).toContain('Khôi phục mật khẩu');
    expect(email.html).toContain('support@famidoc.online');
    expect(email.html).not.toContain('#2E37A4');
  });
});
