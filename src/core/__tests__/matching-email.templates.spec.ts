import {
  buildMatchingQueueAssignedEmail,
  buildMatchingQueueIntakeEmail,
} from '../mailer/templates/matching-email.templates';

describe('matching-email.templates', () => {
  it('builds matching queue intake email with info tone, SLA details, and XSS escaping', () => {
    const email = buildMatchingQueueIntakeEmail({
      recipientName: 'Trần <script>alert(1)</script> Lan',
      queueRequestId: 'queue-uuid-1',
      packageName: 'Gói Chăm Sóc & Bảo Vệ',
      memberCount: 4,
      slaHours: 12,
      trackingUrl: 'https://app.famidoc.test/booking',
    });

    expect(email.subject).toBe(
      'FamiDoc - Đã tiếp nhận yêu cầu tìm bác sĩ vào hàng chờ điều phối',
    );
    expect(email.text).toContain('queue-uuid-1');
    expect(email.text).toContain('12 giờ');
    expect(email.text).toContain('4 thành viên');
    expect(email.html).toContain('#0037c1');
    expect(email.html).toContain('queue-uuid-1');
    expect(email.html).toContain('Gói Chăm Sóc &amp; Bảo Vệ');
    expect(email.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('Theo dõi yêu cầu');
  });

  it('builds matching queue assigned email and omits CTA cleanly when confirmUrl is absent', () => {
    const withUrl = buildMatchingQueueAssignedEmail({
      recipientName: null,
      doctorName: 'BS. Lê Thu Hà',
      facilityName: 'Phòng khám Tâm Đức',
      packageName: 'Gói Đồng Hành',
      confirmUrl: 'https://app.famidoc.test/booking?queueId=q-1',
    });

    expect(withUrl.subject).toBe(
      'FamiDoc - Đã phân công bác sĩ gia đình, mời xác nhận hợp đồng',
    );
    expect(withUrl.text).toContain('Xin chào Quý khách,');
    expect(withUrl.text).toContain(
      'https://app.famidoc.test/booking?queueId=q-1',
    );
    expect(withUrl.html).toContain('Xác nhận hợp đồng');
    expect(withUrl.html).toContain('BS. Lê Thu Hà');

    const withoutUrl = buildMatchingQueueAssignedEmail({
      recipientName: 'Anh Nam',
      doctorName: 'BS. Lê Thu Hà',
      facilityName: 'Phòng khám Tâm Đức',
      packageName: 'Gói Đồng Hành',
    });

    expect(withoutUrl.text).not.toContain('/booking?queueId=');
    expect(withoutUrl.html).not.toContain('<a href=');
    expect(withoutUrl.html).not.toContain('sao chép đường dẫn sau');
  });
});
