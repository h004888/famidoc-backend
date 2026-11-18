import {
  buildB2bStaffingContractHtml,
  normalizeB2bSupplementaryTerms,
} from '../templates/build-b2b-staffing-contract-html';
import { buildDocumensoContractFieldValues } from '../templates/build-documenso-contract-html';
import { resolvePlatformLegalIdentity } from '../templates/platform-legal-identity';

describe('B2B Staffing Contract Template & Shared Platform Identity', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('shares identical FAMIDOC_LEGAL_* identity across B2B and 4-party templates', () => {
    process.env.FAMIDOC_LEGAL_COMPANY_NAME = 'Công ty Cổ phần FamiDoc Việt Nam';
    process.env.FAMIDOC_LEGAL_TAX_CODE = '0319876543';
    process.env.FAMIDOC_LEGAL_ADDRESS = '123 Nguyễn Huệ, Quận 1, TP.HCM';
    process.env.FAMIDOC_LEGAL_REPRESENTATIVE = 'Nguyễn Văn Pháp';
    process.env.FAMIDOC_LEGAL_SUPPORT_CONTACT = 'legal@famidoc.vn';

    const resolved = resolvePlatformLegalIdentity();
    const fourParty = buildDocumensoContractFieldValues({
      contractNumber: 'FMD-2026-001',
      durationMonths: 12,
      pkg: {
        packageName: 'Gói Gia Đình',
        lineageCode: 'FAM-STD',
        includedMembers: 4,
        periodicVisitsQuota: 4,
        telehealthQuota: 12,
      },
      pricing: {
        basePriceVnd: 5000000,
        additionalMemberTotalVnd: 0,
        totalPriceVnd: 5000000,
      },
      memberCount: 4,
      family: {},
      facility: { facilityName: 'BV Hoàn Mỹ' },
    });

    const b2bHtml = buildB2bStaffingContractHtml({
      contractNumber: 'STF-2026-001',
      facilityName: 'BV Hoàn Mỹ',
      facilityLicenseNumber: '01293/BYT-GPHĐ',
      facilityLicenseIssuer: 'Bộ Y tế',
      facilityLicenseDate: '2024-05-15',
      facilityTaxCode: '0102030405',
      facilityAddress: '100 Trần Hưng Đạo, Hà Nội',
      facilityRepresentativeName: 'BS. Trần Văn B',
      facilityEmail: 'contact@hoanmy.vn',
      facilityPhone: '0901234567',
      facilityHotline: '19008888',
      facilityBankName: 'Vietcombank',
      facilityBankAccountNumber: '001100223344',
      facilityBankAccountHolder: 'BV HOAN MY',
      platformCommissionRate: 15,
      facilityRevenueRate: 85,
      startDate: '2026-01-01',
      endDate: '2026-12-31',
    });

    expect(fourParty.party_d_company_name).toBe(resolved.companyName);
    expect(fourParty.party_d_tax_code).toBe(resolved.taxCode);
    expect(fourParty.party_d_address).toBe(resolved.address);
    expect(fourParty.party_d_representative).toBe(resolved.representative);
    expect(fourParty.party_d_contact).toBe(resolved.supportContact);

    expect(b2bHtml).toContain('Công ty Cổ phần FamiDoc Việt Nam');
    expect(b2bHtml).toContain('0319876543');
    expect(b2bHtml).toContain('123 Nguyễn Huệ, Quận 1, TP.HCM');
    expect(b2bHtml).toContain('Nguyễn Văn Pháp');
    expect(b2bHtml).toContain('legal@famidoc.vn');
  });

  it('renders complete 10-article B2B structure, Party B details, and default supplementary text', () => {
    const html = buildB2bStaffingContractHtml({
      contractNumber: 'STF-2026-FULL01',
      facilityName: 'Phòng khám Đa khoa FamiCare',
      facilityLicenseNumber: '00888/SYT-GPHĐ',
      facilityLicenseIssuer: 'Sở Y tế TP.HCM',
      facilityLicenseDate: '2023-08-20',
      facilityTaxCode: '0311223344',
      facilityAddress: '45 Lê Lợi, Quận 1, TP.HCM',
      facilityRepresentativeName: 'BS. Lê Thị Hoa',
      facilityEmail: 'hoa@famicare.vn',
      facilityPhone: '0911223344',
      facilityHotline: '19006688',
      facilityBankName: 'Techcombank',
      facilityBankAccountNumber: '19033445566',
      facilityBankAccountHolder: 'PK FAMICARE',
      platformCommissionRate: 15,
      facilityRevenueRate: 85,
      startDate: '2026-02-01',
      endDate: '2027-01-31',
    });

    for (let i = 1; i <= 10; i++) {
      expect(html).toContain(`Điều ${i}.`);
    }
    expect(html).toContain('CĂN CỨ PHÁP LÝ');
    expect(html).toContain('Luật Giao dịch điện tử số 20/2023/QH15');
    expect(html).toContain('Bảo hiểm trách nhiệm nghề nghiệp khám bệnh, chữa bệnh');
    expect(html).toContain('Sở Y tế TP.HCM');
    expect(html).toContain('20/08/2023');
    expect(html).toContain('19006688');
    expect(html).toContain('Không có thỏa thuận bổ sung nào khác.');
    expect(html).toContain('[[SIG_HEALTHCARE_FACILITY]]');
    expect(html).toContain('[[SIG_ADMIN]]');
  });

  it('escapes XSS payloads in supplementary terms and strips legacy boilerplate', () => {
    expect(
      normalizeB2bSupplementaryTerms(
        'HỢP ĐỒNG NGUYÊN TẮC CUNG ỨNG NGUỒN NHÂN LỰC Y TẾ B2B\nĐiều 1...',
      ),
    ).toBeNull();

    const html = buildB2bStaffingContractHtml({
      contractNumber: 'STF-2026-XSS',
      facilityName: 'PK <script>alert(1)</script>',
      facilityLicenseNumber: 'GPHĐ-1',
      facilityTaxCode: '0102030405',
      facilityAddress: 'Hà Nội',
      facilityRepresentativeName: 'Đại diện A',
      facilityEmail: 'a@b.vn',
      facilityPhone: '0900000001',
      facilityBankName: 'VCB',
      facilityBankAccountNumber: '123456',
      facilityBankAccountHolder: 'PK A',
      platformCommissionRate: 15,
      facilityRevenueRate: 85,
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      contractTerms: 'Ưu tiên đối soát ngày 03 <img src=x onerror=alert(1)>',
    });

    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('Ưu tiên đối soát ngày 03 &lt;img src=x onerror=alert(1)&gt;');
  });
});
