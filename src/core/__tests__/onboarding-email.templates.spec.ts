import {
  buildDoctorLevel2ApprovedEmail,
  buildDoctorLevel2ApprovedFacilityNoticeEmail,
  buildDoctorLevel2RejectedEmail,
  buildDoctorLevel2RejectedFacilityNoticeEmail,
  buildDoctorProvisioningEmail,
  buildFacilityLegalApprovedEmail,
  buildFacilityLegalRejectedEmail,
  buildFacilityProvisioningEmail,
} from '../mailer/templates/onboarding-email.templates';

describe('onboarding-email.templates', () => {
  const loginUrl = 'https://app.famidoc.test/login';

  it('builds doctor provisioning email with credentials, XSS protection, and optional CTA', () => {
    const withCta = buildDoctorProvisioningEmail({
      email: 'bs.an@famidoc.test',
      doctorName: 'Nguyễn <script>alert(1)</script> An',
      facilityName: 'Phòng khám & Gia đình',
      initialPassword: 'Fd!Pass<123>',
      loginUrl,
    });

    expect(withCta.subject).toBe(
      'FamiDoc - Thư mời kích hoạt tài khoản Bác sĩ gia đình',
    );
    expect(withCta.text).toContain('bs.an@famidoc.test');
    expect(withCta.text).toContain('Fd!Pass<123>');
    expect(withCta.text).toContain(loginUrl);
    expect(withCta.html).toContain('Đăng nhập cổng Bác sĩ');
    expect(withCta.html).toContain(loginUrl);
    expect(withCta.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(withCta.html).toContain('Fd!Pass&lt;123&gt;');
    expect(withCta.html).not.toContain('<script>');

    const withoutCta = buildDoctorProvisioningEmail({
      email: 'bs.an@famidoc.test',
      doctorName: 'Nguyễn An',
      facilityName: 'Phòng khám Gia đình',
      initialPassword: 'Fd!Pass123',
    });
    expect(withoutCta.html).not.toContain('Đăng nhập cổng Bác sĩ');
    expect(withoutCta.html).not.toContain('<a href=');
  });

  it('builds doctor level-2 approval emails for both doctor and facility', () => {
    const docMail = buildDoctorLevel2ApprovedEmail({
      doctorName: 'Trần Bình',
      loginUrl,
    });
    expect(docMail.subject).toBe(
      'FamiDoc - Hồ sơ bác sĩ của bạn đã được phê duyệt thành công',
    );
    expect(docMail.html).toContain('#03864b');
    expect(docMail.html).toContain('ACTIVE');
    expect(docMail.text).toContain('ACTIVE');

    const facMail = buildDoctorLevel2ApprovedFacilityNoticeEmail({
      facilityName: 'Bệnh viện Hoàn Mỹ',
      doctorName: 'Trần Bình',
      loginUrl,
    });
    expect(facMail.subject).toBe(
      'FamiDoc - Bác sĩ Trần Bình đã hoàn tất thẩm định 2 cấp',
    );
    expect(facMail.html).toContain('Bệnh viện Hoàn Mỹ');
    expect(facMail.html).toContain('#03864b');
  });

  it('builds doctor level-2 rejection emails for both doctor and facility with escaped reasons', () => {
    const reason = 'Thiếu dấu giáp lai <img src=x onerror=alert(1)>';
    const docMail = buildDoctorLevel2RejectedEmail({
      doctorName: 'Lê Minh',
      rejectionReason: reason,
      loginUrl,
    });
    expect(docMail.subject).toBe(
      'FamiDoc - Hồ sơ chuyên môn bác sĩ cần bổ sung (Thẩm định Cấp 2)',
    );
    expect(docMail.text).toContain(reason);
    expect(docMail.html).toContain('#ba1a1a');
    expect(docMail.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(docMail.html).not.toContain('<img src=x');

    const facMail = buildDoctorLevel2RejectedFacilityNoticeEmail({
      facilityName: 'CSYT An Sinh',
      doctorName: 'Lê Minh',
      rejectionReason: reason,
    });
    expect(facMail.subject).toBe(
      'FamiDoc - Hồ sơ bác sĩ Lê Minh bị từ chối ở Thẩm định Cấp 2',
    );
    expect(facMail.text).toContain(reason);
    expect(facMail.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(facMail.html).not.toContain('<a href=');
  });

  it('builds facility provisioning, approval, and rejection emails with FamiDoc - subject prefix', () => {
    const provisioned = buildFacilityProvisioningEmail({
      recipientName: null,
      facilityName: 'BV Đa khoa An Sinh',
      email: 'contact@ansinh.vn',
      initialPassword: 'Fd!Fac999',
      loginUrl,
    });
    expect(provisioned.subject).toBe(
      'FamiDoc - Thông báo cấp tài khoản Cơ sở y tế đối tác',
    );
    expect(provisioned.text).toContain('Kính gửi BV Đa khoa An Sinh,');
    expect(provisioned.text).toContain('Fd!Fac999');
    expect(provisioned.html).toContain('Đăng nhập cổng Đối tác');

    const approved = buildFacilityLegalApprovedEmail({
      recipientName: 'Nguyễn Quản Lý',
      facilityName: 'BV Đa khoa An Sinh',
    });
    expect(approved.subject).toBe(
      'FamiDoc - Chúc mừng! Hồ sơ pháp lý cơ sở y tế đã được kích hoạt thành công',
    );
    expect(approved.html).toContain('#03864b');
    expect(approved.html).toContain('ACTIVE');

    const rejected = buildFacilityLegalRejectedEmail({
      recipientName: 'Nguyễn Quản Lý',
      facilityName: 'BV Đa khoa An Sinh',
      reason: 'Sai mã số thuế <script>bad()</script>',
      loginUrl,
    });
    expect(rejected.subject).toBe(
      'FamiDoc - Yêu cầu bổ sung hồ sơ pháp lý Cơ sở y tế',
    );
    expect(rejected.html).toContain('#ba1a1a');
    expect(rejected.html).toContain('&lt;script&gt;bad()&lt;/script&gt;');
    expect(rejected.html).not.toContain('<script>');
  });
});
