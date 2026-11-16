import {
  DOCUMENSO_FIELD_NAMES,
  DOCUMENSO_PARALLEL_ROLES_AFTER_FAMILY,
  DOCUMENSO_RECIPIENT_ROLES,
  DOCUMENSO_SIGNATURE_MARKERS,
  loadMasterContractTemplateHtml,
} from '../templates/documenso-contract-template.schema';
import {
  buildDocumensoContractFieldValues,
  buildDocumensoContractHtml,
  escapeHtml,
  validateRealPartyContractData,
} from '../templates/build-documenso-contract-html';
import type { BuildDocumensoContractHtmlInput } from '../templates/build-documenso-contract-html';

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

  it('chứa placeholder đủ 35 biến DOCUMENSO_FIELD_NAMES (không còn party_a_id_number)', () => {
    expect(DOCUMENSO_FIELD_NAMES).not.toContain('party_a_id_number');
    expect(html).not.toContain('{{party_a_id_number}}');
    expect(html).not.toContain('CCCD/Định danh');
    for (const fieldName of DOCUMENSO_FIELD_NAMES) {
      expect(html).toContain(`{{${fieldName}}}`);
    }
  });

  it('bố cục đánh số phân cấp không còn danh sách dấu chấm tròn clause-list và có chống ngắt dòng', () => {
    // Không còn <ul class="clause-list"> hay CSS .clause-list ở Điều 3–11
    expect(html).not.toContain('clause-list');
    expect(html).not.toContain('<ul class="clause-');
    // Đánh số phân cấp bằng div.clause-item kèm break-inside: avoid
    expect(html).toContain('class="clause-item"');
    expect(html).toContain('class="clause-item sub"');
    expect(html).toContain('break-inside: avoid');
    // Điều 2 đánh số liên tục 2.1 / 2.2 / 2.3
    expect(html).toContain('<strong>2.1.');
    expect(html).toContain('<strong>2.2.');
    expect(html).toContain('<strong>2.3.');
  });

  it('đủ 4 marker chữ ký ASCII [[SIG_*]] với styling vô hình', () => {
    for (const role of DOCUMENSO_RECIPIENT_ROLES) {
      const marker = DOCUMENSO_SIGNATURE_MARKERS[role];
      expect(html).toContain(marker);
    }
    expect(html).toContain('font-family: monospace; font-size: 2px; color: #ffffff;');
  });

  it('lưới chữ ký 2x2 có min-height khoảng trống vùng ký và ghi chú đối chiếu Chứng thư xác thực', () => {
    expect(html).toContain('grid-template-columns: 1fr 1fr');
    expect(html).toContain('min-height: 160px');
    expect(html).toContain('min-height: 90px');
    expect(html).toContain('class="sig-space"');
    expect(html).toContain('Ký và đối chiếu Chứng thư xác thực');
    expect(html).toContain('Chứng thư xác thực');
  });

  it('giải thích thuật ngữ hệ thống bằng tiếng Việt (ACTIVE, PENDING_PAYMENT, memberCount, telemedicine)', () => {
    expect(html).toContain('GIẢI THÍCH THUẬT NGỮ');
    expect(html).toContain('ACTIVE (Đang hiệu lực)');
    expect(html).toContain('PENDING_PAYMENT (Chờ thanh toán)');
    expect(html).toContain('memberCount (Số suất thành viên)');
    expect(html).toContain('Tư vấn từ xa (telemedicine)');
    expect(html).toContain('Điều 80 Luật Khám bệnh, chữa bệnh số 15/2023/QH15');
  });

  it('Điều 2.3 bao quát patientIds trước/sau kích hoạt, tiếp nhận 24 giờ và hoàn trả 100% trong 03 ngày làm việc', () => {
    expect(html).toContain('<strong>2.3. Cơ chế định danh thành viên (trước hoặc sau kích hoạt):</strong>');
    expect(html).toContain('patientIds');
    expect(html).toContain('tiếp nhận hồ sơ các thành viên được định danh trong vòng 24 giờ');
    expect(html).toContain('hoàn trả 100% giá trị phần bị từ chối trong vòng 03 ngày làm việc');
  });

  it('Điều 5 có đủ khoản 5.2.b (bảo hiểm & trách nhiệm liên đới) và 5.3.b (ghi nhận tức thời thông điệp dữ liệu)', () => {
    expect(html).toContain('<strong>5.2.b.</strong>');
    expect(html).toContain('bảo hiểm trách nhiệm nghề nghiệp khám bệnh, chữa bệnh (KBCB)');
    expect(html).toContain('chịu trách nhiệm liên đới bồi thường');
    expect(html).toContain('<strong>5.3.b.</strong>');
    expect(html).toContain('ghi nhận tức thời');
    expect(html).toContain('thông điệp dữ liệu điện tử');
  });

  it('Điều 7.2 khóa công thức hoàn tiền cố định, không phí phạt/phụ phí, hoàn trả 05 ngày làm việc', () => {
    expect(html).toContain('<strong>7.2. Đơn phương chấm dứt trước hạn &amp; Công thức hoàn tiền cố định');
    expect(html).toContain('[Tổng giá trị thanh toán] trừ đi [Giá trị các lượt khám tại nhà hoặc tư vấn từ xa thực tế đã hoàn thành tính theo đơn giá niêm yết công khai của từng lượt lẻ]');
    expect(html).toContain('không áp dụng bất kỳ khoản phí phạt hay phụ phí hành chính nào');
    expect(html).toContain('trong vòng 05 ngày làm việc');
  });

  it('Điều 10.1 bổ sung quyền chọn Trọng tài Thương mại và Điều 11 quy định điều khoản chung', () => {
    expect(html).toContain('<strong>10.1. Giải quyết tranh chấp:</strong>');
    expect(html).toContain('Trọng tài Thương mại theo thủ tục rút gọn');
    expect(html).toContain('Tòa án nhân dân có thẩm quyền');
    expect(html).toContain('ĐIỀU 11. ĐIỀU KHOẢN CHUNG');
    expect(html).toContain('11.1. Ngôn ngữ ưu tiên');
    expect(html).toContain('bản tiếng Việt luôn là bản có giá trị ưu tiên cao nhất');
    expect(html).toContain('11.2. Tính độc lập từng phần');
    expect(html).toContain('11.3. Thông báo và liên hệ chính thức');
    expect(html).toContain('support@famidoc.online');
  });

  it('bảng giá mở rộng nhãn và hiển thị rõ công thức phụ phí thành viên bổ sung', () => {
    expect(html).toContain('width: 42%');
    expect(html).toContain('Phụ phí thành viên bổ sung — Công thức: [Số suất bổ sung] x [Đơn giá mỗi suất] = [Tổng phụ phí]');
    expect(html).toContain('TỔNG GIÁ TRỊ THANH TOÁN (Giá gốc + Tổng phụ phí thành viên bổ sung)');
    expect(html).toContain('Giá gốc gói dịch vụ (chưa gồm phụ phí thành viên bổ sung)');
  });

  it('phần mở đầu hiển thị tiêu đề hợp đồng, số hợp đồng và ngày lập trước phần Căn cứ pháp lý', () => {
    const titleIdx = html.indexOf('HỢP ĐỒNG CUNG CẤP DỊCH VỤ CHĂM SÓC SỨC KHỎE GIA ĐÌNH (4 BÊN)');
    const contractNoIdx = html.indexOf('<strong>Số hợp đồng:</strong>');
    const createdDateIdx = html.indexOf('<strong>Ngày lập:</strong>');
    const legalBasisIdx = html.indexOf('CĂN CỨ PHÁP LÝ');
    expect(titleIdx).toBeGreaterThan(-1);
    expect(contractNoIdx).toBeGreaterThan(titleIdx);
    expect(createdDateIdx).toBeGreaterThan(contractNoIdx);
    expect(legalBasisIdx).toBeGreaterThan(createdDateIdx);
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

  // ===== Task 2.2: nạp dữ liệu thật Bên B/C/D và guard chặn dữ liệu demo =====

  const buildMinimalContractInput = (
    overrides: Partial<BuildDocumensoContractHtmlInput> = {},
  ): BuildDocumensoContractHtmlInput => ({
    contractNumber: 'FD-2026-00002',
    createdAt: new Date('2026-06-15'),
    durationMonths: 12,
    pkg: {
      packageName: 'Gói Chăm sóc Sức khỏe Toàn diện',
      lineageCode: 'PACK-001',
      includedMembers: 3,
      periodicVisitsQuota: 8,
      telehealthQuota: 12,
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
      },
    },
    facility: {
      facilityName: 'Trung tâm Y tế Quận 1',
      licenseNumber: '48/GPHĐ-BYT',
      address: '45 Lê Lợi, Quận 1, TP.HCM',
      user: {
        fullName: 'GS. BS. Trần Văn Bảo',
        email: 'bao.tv@ytedanh1.vn',
        phone: '0908765432',
      },
    },
    ...overrides,
  });

  it('điền số CCHN của Bên C từ DoctorCredential (PRACTICE_LICENSE_CCHN) khi doctor.licenseNumber trống', () => {
    const values = buildDocumensoContractFieldValues(
      buildMinimalContractInput({
        doctor: {
          doctorName: 'BS. Lê Thị Mai',
          specialty: 'Y học gia đình',
          credentials: [
            {
              certificateNumber: 'CCHN-12345-GCN-BYT',
              credentialType: 'PRACTICE_LICENSE_CCHN',
            },
          ],
          user: { fullName: 'BS. Lê Thị Mai', email: 'mai.ls@famidoc.online' },
        },
      }),
    );
    expect(values.party_c_license_number).toBe('CCHN-12345-GCN-BYT');
  });

  it('điền liên hệ Bên B ưu tiên hotline của cơ sở y tế', () => {
    const values = buildDocumensoContractFieldValues(
      buildMinimalContractInput({
        facility: {
          facilityName: 'Trung tâm Y tế Quận 1',
          hotline: '18006969',
          phone: '02838223344',
          email: 'contact@ytedanh1.vn',
          user: {
            fullName: 'GS. BS. Trần Văn Bảo',
            email: 'bao.tv@ytedanh1.vn',
            phone: '0908765432',
          },
        },
      }),
    );
    expect(values.party_b_contact).toContain('18006969');
    // hotline được ưu tiên, thay cho số phone/phone của user
    expect(values.party_b_contact.split(' | ')[0]).toBe('18006969');
    expect(values.party_b_contact).not.toContain('02838223344');
  });

  it('đọc thông tin pháp nhân Bên D từ biến môi trường FAMIDOC_LEGAL_*', () => {
    const prev = { ...process.env };
    try {
      process.env.FAMIDOC_LEGAL_COMPANY_NAME = 'Công ty Cổ phần FamiDoc Việt Nam';
      process.env.FAMIDOC_LEGAL_TAX_CODE = '0312345678';
      process.env.FAMIDOC_LEGAL_ADDRESS = '12 Đường ABC, Quận 1, TP.HCM';
      process.env.FAMIDOC_LEGAL_REPRESENTATIVE = 'Nguyễn Văn Pháp';
      process.env.FAMIDOC_LEGAL_SUPPORT_CONTACT = 'hotro@famidoc.vn';

      const values = buildDocumensoContractFieldValues(buildMinimalContractInput());
      expect(values.party_d_company_name).toBe('Công ty Cổ phần FamiDoc Việt Nam');
      expect(values.party_d_tax_code).toBe('0312345678');
      expect(values.party_d_address).toBe('12 Đường ABC, Quận 1, TP.HCM');
      expect(values.party_d_representative).toBe('Nguyễn Văn Pháp');
      expect(values.party_d_contact).toBe('hotro@famidoc.vn');
    } finally {
      process.env = prev;
    }
  });

  it('validateRealPartyContractData chấp nhận dữ liệu 4 bên hợp lệ (không DEMO / .invalid)', () => {
    const values = buildDocumensoContractFieldValues(buildMinimalContractInput());
    const result = validateRealPartyContractData(values);
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('validateRealPartyContractData phát hiện dữ liệu DEMO ở thông tin các bên', () => {
    const values = buildDocumensoContractFieldValues(
      buildMinimalContractInput({
        admin: {
          fullName: 'DEMO - Quản trị viên',
          email: 'admin@famidoc.online',
        },
      }),
    );
    const result = validateRealPartyContractData(values);
    expect(result.valid).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues.join(' | ')).toContain('Bên D');
    expect(result.issues.join(' | ')).toContain('DEMO');
  });

  it('validateRealPartyContractData phát hiện email tên miền .invalid ở thông tin các bên và recipients', () => {
    const values = buildDocumensoContractFieldValues(
      buildMinimalContractInput({
        family: {
          familyCode: 'HU-DINH-01',
          address: '123 Nguyễn Huệ, Quận 1, TP.HCM',
          representativeUser: {
            fullName: 'Nguyễn Văn An',
            email: 'an.nguyen@famidoc.invalid',
            phone: '0901234567',
          },
        },
      }),
    );
    const result = validateRealPartyContractData(values, [
      {
        role: 'ADMIN',
        name: 'Ban Quản trị FamiDoc',
        email: 'admin@demo.famidoc.invalid',
      },
    ]);
    expect(result.valid).toBe(false);
    expect(result.issues.join(' | ')).toContain('Bên A');
    expect(result.issues.join(' | ')).toContain('.invalid');
    expect(result.issues.join(' | ')).toContain('Người ký ADMIN');
  });

  it('chuỗi mô tả quyền lợi đã Việt hóa (tư vấn khám chữa bệnh từ xa)', () => {
    const values = buildDocumensoContractFieldValues(buildMinimalContractInput());
    expect(values.package_entitlements_summary).toContain('lượt khám, theo dõi tại nhà');
    expect(values.package_entitlements_summary).toContain('tư vấn khám chữa bệnh từ xa (telemedicine)');
  });
});
