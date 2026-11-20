import {
  buildPasswordResetOtpEmail,
  buildRegistrationOtpEmail,
} from '../templates/otp-email.template';

describe('otp-email.template', () => {
  it('tạo email OTP đăng ký có đủ subject, text, html và escape HTML an toàn', () => {
    const email = buildRegistrationOtpEmail({
      fullName: 'Nguyễn <script>alert(1)</script> An',
      otp: '654321',
      expiresInMinutes: 5,
    });

    expect(email.subject).toContain('Mã xác thực OTP đăng ký tài khoản');
    expect(email.text).toContain('654321');
    expect(email.text).toContain('5 phút');
    expect(email.html).toContain('654321');
    expect(email.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(email.html).not.toContain('<script>');
  });

  it('tạo email OTP khôi phục mật khẩu có đủ subject, text và html', () => {
    const email = buildPasswordResetOtpEmail({ otp: '112233', expiresInMinutes: 10 });

    expect(email.subject).toContain('đặt lại mật khẩu');
    expect(email.text).toContain('112233');
    expect(email.html).toContain('112233');
    expect(email.html).toContain('10 phút');
  });
});
