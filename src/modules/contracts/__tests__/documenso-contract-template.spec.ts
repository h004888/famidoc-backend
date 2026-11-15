import {
  DOCUMENSO_FIELD_NAMES,
  DOCUMENSO_PARALLEL_ROLES_AFTER_FAMILY,
  DOCUMENSO_RECIPIENT_ROLES,
  DOCUMENSO_SIGNATURE_MARKERS,
  loadMasterContractTemplateHtml,
} from '../templates/documenso-contract-template.schema';
import { buildDocumensoContractHtml, escapeHtml } from '../templates/build-documenso-contract-html';

describe('Documenso Four-Party Master Contract Template (VN Legal Standard)', () => {
  const html = loadMasterContractTemplateHtml();

  it('nạp được file HTML mẫu và chứa đầy đủ thông tin 4 bên đúng quy ước A/B/C/D', () => {
    expect(html).toContain('CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM');
    expect(html).toContain('1. BÊN A (Bên sử dụng dịch vụ - Đại diện Hộ gia đình)');
    expect(html).toContain('2. BÊN B (Cơ sở khám bệnh, chữa bệnh chủ quản)');
    expect(html).toContain('3. BÊN C (Bác sĩ Gia đình trực tiếp phụ trách chuyên môn)');
    expect(html).toContain('4. BÊN D (Bên cung cấp nền tảng công nghệ');
  });

  it('khai báo đầy đủ căn cứ pháp luật Việt Nam bắt buộc cho hợp đồng y tế điện tử 4 bên', () => {
    expect(html).toContain('91/2015/QH13');
    expect(html).toContain('15/2023/QH15');
    expect(html).toContain('96/2023/NĐ-CP');
    expect(html).toContain('21/2019/TT-BYT');
    expect(html).toContain('32/2023/TT-BYT');
    expect(html).toContain('20/2023/QH15');
    expect(html).toContain('19/2023/QH15');
    expect(html).toContain('91/2025/QH15');
    expect(html).toContain('13/2023/NĐ-CP');
    expect(html).toContain('https://sign.famidoc.online');
  });

  it('không còn thẻ text-field hay signature-field của DocuSeal', () => {
    expect(html).not.toContain('<text-field');
    expect(html).not.toContain('</text-field>');
    expect(html).not.toContain('<signature-field');
    expect(html).not.toContain('</signature-field>');
  });

  it('chứa placeholder đủ 36 biến DOCUMENSO_FIELD_NAMES', () => {
    for (const fieldName of DOCUMENSO_FIELD_NAMES) {
      expect(html).toContain(`{{${fieldName}}}`);
    }
  });

  it('đủ 4 marker chữ ký ASCII [[SIG_*]] với styling vô hình', () => {
    for (const role of DOCUMENSO_RECIPIENT_ROLES) {
      const marker = DOCUMENSO_SIGNATURE_MARKERS[role];
      expect(html).toContain(marker);
    }
    expect(html).toContain('font-family: monospace; font-size: 2px; color: #ffffff;');
  });

  it('tham chiếu điều 9 & 10 dùng tên "Documenso" thay "DocuSeal"', () => {
    expect(html).toContain('ĐIỀU 9. CÔNG NHẬN CHỮ KÝ ĐIỆN TỬ VÀ TRÌNH TỰ KÝ KẾT TRÊN DOCUMENSO');
    expect(html).toContain('hệ thống ký kết Documenso');
    expect(html).toContain('ký đầu tiên trên Documenso');
    expect(html).toContain('PDF hoàn chỉnh xuất từ Documenso');
  });

  it('không còn tham chiếu "docuseal" (case-insensitive) trong template', () => {
    expect(html.toLowerCase()).not.toContain('docuseal');
  });

  it('escapeHtml mã hóa đúng các ký tự đặc biệt HTML/XML', () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;',
    );
    expect(escapeHtml('A & B')).toBe('A &amp; B');
    expect(escapeHtml("O'Reilly")).toBe("O&#039;Reilly");
  });

  it('buildDocumensoContractHtml tạo ra chuỗi HTML chứa đầy đủ giá trị tiếng Việt và 4 marker chữ ký', () => {
    const htmlOutput = buildDocumensoContractHtml({
      contractNumber: 'FD-2026-00001',
      createdAt: new Date('2026-06-15'),
      durationMonths: 12,
      pkg: {
        packageName: 'Gói Chăm sóc Sức khỏe Toàn diện',
        lineageCode: 'PACK-001',
        includedMembers: 3,
        periodicVisitsQuota: 8,
        telehealthQuota: 12,
        description: 'Khám tại nhà + telemedicine',
      },
      pricing: {
        basePriceVnd: 12000000,
        additionalMemberTotalVnd: 3000000,
        additionalMemberUnitPriceVnd: 1500000,
        totalPriceVnd: 15000000,
      },
      memberCount: 5,
      family: {
        familyCode: 'HU-DINH-01',
        address: '123 Nguyễn Huệ, Quận 1, TP.HCM',
        representativeUser: {
          fullName: 'Nguyễn Văn An',
          email: 'an.nguyen@example.com',
          phone: '0901234567',
          citizenId: '060234567890',
        },
      },
      facility: {
        facilityName: 'Trung tâm Y tế Quận 1',
        licenseNumber: '48/GPHĐ-BYT',
        address: '45 Lê Lợi, Quận 1, TP.HCM',
        phone: '02838223344',
        email: 'contact@ytedanh1.vn',
        representativeName: 'GS. BS. Trần Văn Bảo',
        user: {
          fullName: 'GS. BS. Trần Văn Bảo',
          email: 'bao.tv@ytedanh1.vn',
          phone: '0908765432',
        },
      },
      doctor: {
        doctorName: 'BS. Lê Thị Mai',
        licenseNumber: '12345-GCN-BYT',
        specialty: 'Nội tổng quát',
        user: {
          fullName: 'BS. Lê Thị Mai',
          email: 'mai.ls@famidoc.online',
          phone: '0912345678',
        },
      },
      admin: {
        fullName: 'Ban Quản trị FamiDoc',
        email: 'admin@famidoc.online',
      },
      additionalTerms: 'Bên B ưu tiên lịch hẹn vào buổi sáng.',
    });

    // Kiểm tra giá trị tiếng Việt không bị escape sai
    expect(htmlOutput).toContain('Nguyễn Văn An');
    expect(htmlOutput).toContain('Trung tâm Y tế Quận 1');
    expect(htmlOutput).toContain('123 Nguyễn Huệ, Quận 1, TP.HCM');
    expect(htmlOutput).toContain('Gói Chăm sóc Sức khỏe Toàn diện');

    // Kiểm tra marker chữ ký vẫn giữ nguyên (escape áp dụng cho giá trị trường, không phải marker)
    expect(htmlOutput).toContain('[[SIG_FAMILY_REP]]');
    expect(htmlOutput).toContain('[[SIG_HEALTHCARE_FACILITY]]');
    expect(htmlOutput).toContain('[[SIG_ASSIGNED_DOCTOR]]');
    expect(htmlOutput).toContain('[[SIG_ADMIN]]');

    // Không còn tag text-field hay signature-field
    expect(htmlOutput).not.toContain('<text-field');
    expect(htmlOutput).not.toContain('<signature-field');

    // Placeholder đã được thay thế (không còn {{field_name}} nào nữa)
    for (const fieldName of DOCUMENSO_FIELD_NAMES) {
      expect(htmlOutput).not.toContain(`{{${fieldName}}}`);
    }

    // Không có nội dung docuseal trong output
    expect(htmlOutput.toLowerCase()).not.toContain('docuseal');
  });

  it('XSS: escape đúng khi additionalTerms chứa script tag độc hại', () => {
    const htmlOutput = buildDocumensoContractHtml({
      contractNumber: 'FD-TEST-XSS',
      createdAt: new Date(),
      durationMonths: 3,
      pkg: {
        packageName: 'Gói cơ bản',
        lineageCode: 'PKG-BASIC',
        includedMembers: 1,
        periodicVisitsQuota: 2,
        telehealthQuota: 4,
      },
      pricing: {
        basePriceVnd: 3000000,
        additionalMemberTotalVnd: 0,
        totalPriceVnd: 3000000,
      },
      memberCount: 1,
      family: {
        address: 'Hà Nội',
        representativeUser: { fullName: 'Trần Minh Đức', email: 'duc@test.com', phone: '0987654321' },
      },
      facility: {
        facilityName: 'BV Bạch Mai',
        licenseNumber: '123/GPHĐ',
        address: 'Hà Nội',
        representativeName: 'TS. BS. Phạm Hùng',
      },
      additionalTerms: '<script>alert("XSS attack")</script>',
    });

    // Script tag đã được escape → không thể execute
    expect(htmlOutput).toContain('&lt;script&gt;alert(&quot;XSS attack&quot;)&lt;/script&gt;');
    expect(htmlOutput).not.toContain('<script>alert("XSS attack")</script>');
  });

  it('DOCUMENSO_SUBMITTER_ROLES gồm đủ 4 vai trò ký chuẩn', () => {
    expect(DOCUMENSO_RECIPIENT_ROLES).toEqual([
      'FAMILY_REP',
      'HEALTHCARE_FACILITY',
      'ASSIGNED_DOCTOR',
      'ADMIN',
    ]);
  });

  it('DOCUMENSO_PARALLEL_ROLES_AFTER_FAMILY bỏ qua FAMILY_REP, chỉ giữ 3 bên còn lại', () => {
    expect(DOCUMENSO_PARALLEL_ROLES_AFTER_FAMILY).toEqual([
      'HEALTHCARE_FACILITY',
      'ASSIGNED_DOCTOR',
      'ADMIN',
    ]);
  });
});
