import { ContractPaymentNoticeService } from '../services/contract-payment-notice.service';

describe('ContractPaymentNoticeService', () => {
  let prisma: { medicalContract: { findUnique: jest.Mock } };
  let mailer: { sendMail: jest.Mock };
  let service: ContractPaymentNoticeService;

  const contractRow = {
    id: '11111111-1111-4111-8111-111111111111',
    contractNumber: 'MCTEST0001',
    totalAmount: 9600000,
    billingSnapshot: {
      package: { name: 'Gói Toàn Diện Gia Đình (12 Tháng)' },
      pricing: { totalPriceVnd: 9600000 },
    },
    startDate: new Date(Date.UTC(2026, 0, 1)),
    endDate: new Date(Date.UTC(2026, 11, 31)),
    familyUnit: {
      representativeUser: {
        email: 'dai.dien@famidoc.test',
        fullName: 'Nguyễn Văn An',
      },
    },
    doctor: { user: { fullName: 'BS. Trần Thanh Mai' } },
    servicePackage: { packageName: 'Gói Toàn Diện Gia Đình (12 Tháng)' },
  };

  beforeEach(() => {
    process.env.APP_PUBLIC_URL = 'https://app.famidoc.test';
    prisma = {
      medicalContract: { findUnique: jest.fn().mockResolvedValue(contractRow) },
    };
    mailer = { sendMail: jest.fn().mockResolvedValue(undefined) };
    service = new ContractPaymentNoticeService(prisma as any, mailer);
  });

  afterEach(() => {
    delete process.env.APP_PUBLIC_URL;
  });

  it('gửi mail tới đại diện hộ với đủ thông tin thanh toán và link đúng hợp đồng', async () => {
    await service.sendPaymentNotice(contractRow.id);

    expect(prisma.medicalContract.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: contractRow.id } }),
    );
    expect(mailer.sendMail).toHaveBeenCalledTimes(1);

    const payload = mailer.sendMail.mock.calls[0][0];
    expect(payload.to).toBe('dai.dien@famidoc.test');
    expect(payload.subject).toBe(
      'FamiDoc - Hợp đồng chăm sóc gia đình đã đủ 4 chữ ký, vui lòng thanh toán',
    );
    expect(payload.html).toContain('Chờ thanh toán');
    expect(payload.html).toContain('support@famidoc.online');
    expect(payload.html).toContain('#0037c1');
    expect(payload.html).not.toContain('#2E37A4');

    const expectedUrl = `https://app.famidoc.test/booking/tracking?contractId=${contractRow.id}`;
    for (const body of [payload.text, payload.html]) {
      expect(body).toContain('MCTEST0001');
      expect(body).toContain('Gói Toàn Diện Gia Đình (12 Tháng)');
      expect(body).toContain('9.600.000 đ');
      expect(body).toContain('BS. Trần Thanh Mai');
      expect(body).toContain('01/01/2026 - 31/12/2026');
      expect(body).toContain(expectedUrl);
    }
  });

  it('escape XSS an toàn trong tên đại diện, gói dịch vụ và bác sĩ', async () => {
    prisma.medicalContract.findUnique.mockResolvedValue({
      ...contractRow,
      familyUnit: {
        representativeUser: {
          email: 'dai.dien@famidoc.test',
          fullName: '<script>alert(1)</script>',
        },
      },
      doctor: { user: { fullName: 'BS. <img src=x onerror=alert(1)>' } },
    });

    await service.sendPaymentNotice(contractRow.id);

    const payload = mailer.sendMail.mock.calls[0][0];
    expect(payload.html).not.toContain('<script>');
    expect(payload.html).not.toContain('<img src=x');
    expect(payload.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(payload.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('dùng giá đã chốt trong hợp đồng thay vì đọc lại bảng giá', async () => {
    prisma.medicalContract.findUnique.mockResolvedValue({
      ...contractRow,
      billingSnapshot: {
        package: { name: 'Gói Cũ' },
        pricing: { totalPriceVnd: 5000000 },
      },
      totalAmount: 5000000,
    });

    await service.sendPaymentNotice(contractRow.id);

    const payload = mailer.sendMail.mock.calls[0][0];
    expect(payload.text).toContain('5.000.000 đ');
    expect(payload.text).not.toContain('9.600.000 đ');
  });

  it('không gửi mail khi thiếu APP_PUBLIC_URL và không ném lỗi', async () => {
    delete process.env.APP_PUBLIC_URL;

    await expect(
      service.sendPaymentNotice(contractRow.id),
    ).resolves.toBeUndefined();
    expect(mailer.sendMail).not.toHaveBeenCalled();
  });

  it('không gửi mail khi đại diện hộ không có email', async () => {
    prisma.medicalContract.findUnique.mockResolvedValue({
      ...contractRow,
      familyUnit: { representativeUser: { email: null, fullName: 'A' } },
    });

    await expect(
      service.sendPaymentNotice(contractRow.id),
    ).resolves.toBeUndefined();
    expect(mailer.sendMail).not.toHaveBeenCalled();
  });

  it('không ném lỗi khi dịch vụ mail ném lỗi', async () => {
    mailer.sendMail.mockRejectedValue(new Error('SMTP down'));

    await expect(
      service.sendPaymentNotice(contractRow.id),
    ).resolves.toBeUndefined();
  });

  it('không ném lỗi khi không tìm thấy hợp đồng', async () => {
    prisma.medicalContract.findUnique.mockResolvedValue(null);

    await expect(
      service.sendPaymentNotice(contractRow.id),
    ).resolves.toBeUndefined();
    expect(mailer.sendMail).not.toHaveBeenCalled();
  });
});
