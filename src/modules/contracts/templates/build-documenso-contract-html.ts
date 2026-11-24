import {
  DOCUMENSO_FIELD_NAMES,
  loadMasterContractTemplateHtml,
} from './documenso-contract-template.schema';
import type { DocumensoContractFieldValues } from './documenso-contract-template.schema';
import { resolvePlatformLegalIdentity } from './platform-legal-identity';

/** Mã hoá ký tự HTML để chống XSS khi nội suy giá trị vào template. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export interface BuildDocumensoContractHtmlInput {
  contractNumber: string;
  createdAt?: Date;
  durationMonths: number;
  pkg: {
    packageName: string;
    lineageCode: string;
    includedMembers: number;
    periodicVisitsQuota: number;
    telehealthQuota: number;
    description?: string | null;
  };
  pricing: {
    basePriceVnd: number;
    additionalMemberTotalVnd: number;
    additionalMemberUnitPriceVnd?: number;
    totalPriceVnd: number;
  };
  memberCount: number;
  family: {
    familyCode?: string | null;
    address?: string | null;
    representativeUser?: {
      fullName?: string | null;
      email?: string | null;
      phone?: string | null;
      citizenId?: string | null;
    } | null;
  };
  facility: {
    facilityName: string;
    licenseNumber?: string | null;
    address?: string | null;
    hotline?: string | null;
    phone?: string | null;
    email?: string | null;
    representativeName?: string | null;
    user?: {
      fullName?: string | null;
      email?: string | null;
      phone?: string | null;
    } | null;
  };
  doctor?: {
    doctorName?: string | null;
    licenseNumber?: string | null;
    specialty?: string | null;
    credentials?: Array<{
      certificateNumber?: string | null;
      credentialType?: string | null;
    }> | null;
    user?: {
      fullName?: string | null;
      email?: string | null;
      phone?: string | null;
    } | null;
  } | null;
  admin?: {
    fullName?: string | null;
    email?: string | null;
  } | null;
  additionalTerms?: string | null;
  homeVisitAddress?: string | null;
  isDraftPreview?: boolean;
}

function formatVnd(value: number | string | null | undefined): string {
  const num = Number(value ?? 0);
  if (!Number.isFinite(num)) return '0';
  return new Intl.NumberFormat('vi-VN').format(Math.round(num));
}

function formatDateVi(date: Date): string {
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

export function buildDocumensoContractFieldValues(
  input: BuildDocumensoContractHtmlInput,
): DocumensoContractFieldValues {
  const now = input.createdAt ?? new Date();
  const extraMembers = Math.max(0, input.memberCount - input.pkg.includedMembers);
  const extraUnitPrice =
    input.pricing.additionalMemberUnitPriceVnd ??
    (extraMembers > 0
      ? Math.round(input.pricing.additionalMemberTotalVnd / extraMembers)
      : 0);
  const rep = input.family.representativeUser;
  const facUser = input.facility.user;
  const docUser = input.doctor?.user;
  const platformLegal = resolvePlatformLegalIdentity(input.admin);

  return {
    contract_number: input.contractNumber,
    created_date_vi: formatDateVi(now),
    party_a_name: rep?.fullName || `Đại diện hộ ${input.family.familyCode || ''}`.trim(),
    party_a_address: input.family.address || 'Theo hồ sơ hộ gia đình trên FamiDoc',
    party_a_phone: rep?.phone || 'Theo tài khoản FamiDoc',
    party_a_email: rep?.email || 'Chưa cập nhật',
    party_b_facility_name: input.facility.facilityName,
    party_b_license_number: input.facility.licenseNumber || 'Theo hồ sơ GPHĐ Bộ/Sở Y tế',
    party_b_address: input.facility.address || 'Theo hồ sơ cơ sở y tế',
    party_b_representative:
      input.facility.representativeName || facUser?.fullName || input.facility.facilityName,
    party_b_contact:
      [
        input.facility.hotline || input.facility.phone || facUser?.phone,
        input.facility.email || facUser?.email,
      ]
        .filter(Boolean)
        .join(' | ') || 'Theo hồ sơ cơ sở y tế',
    party_c_doctor_name:
      input.doctor?.doctorName || docUser?.fullName || 'Chờ cơ sở y tế phân công',
    party_c_license_number:
      input.doctor?.licenseNumber ||
      input.doctor?.credentials?.[0]?.certificateNumber ||
      'Theo chứng chỉ hành nghề xác thực trên FamiDoc',
    party_c_specialty: input.doctor?.specialty || 'Y học gia đình',
    party_c_contact:
      [docUser?.email, docUser?.phone].filter(Boolean).join(' | ') ||
      'Liên hệ qua nền tảng FamiDoc',
    party_d_company_name: platformLegal.companyName,
    party_d_tax_code: platformLegal.taxCode,
    party_d_address: platformLegal.address,
    party_d_representative: platformLegal.representative,
    party_d_contact: platformLegal.supportContact,
    package_name: input.pkg.packageName,
    package_code: input.pkg.lineageCode,
    billing_cycle_label: `Chu kỳ ${input.durationMonths} tháng`,
    duration_days: String(Math.max(1, input.durationMonths * 30)),
    package_entitlements_summary: `${input.pkg.periodicVisitsQuota} lượt khám, theo dõi tại nhà và ${input.pkg.telehealthQuota} lượt tư vấn khám chữa bệnh từ xa (telemedicine)`,
    member_count: String(input.memberCount),
    included_members: String(input.pkg.includedMembers),
    base_price_vnd: formatVnd(input.pricing.basePriceVnd),
    extra_members: String(extraMembers),
    extra_member_unit_price_vnd: formatVnd(extraUnitPrice),
    extra_member_total_vnd: formatVnd(input.pricing.additionalMemberTotalVnd),
    total_price_vnd: formatVnd(input.pricing.totalPriceVnd),
    payment_window_hours: '24',
    service_area: input.family.address || input.facility.address || 'Việt Nam (Theo phạm vi CSYT)',
    additional_terms:
      input.additionalTerms?.trim() || 'Không có thỏa thuận bổ sung nào khác.',
  };
}

/**
 * Xây dựng HTML hợp đồng hoàn chỉnh từ đầu vào:
 * 1. Escape toàn bộ giá trị để chống XSS
 * 2. Nội suy đủ 35 biến placeholder vào template HTML
 * 3. Trả về HTML chuỗi đã sẵn sàng cho Puppeteer xuất PDF
 */
export function buildDocumensoContractHtml(input: BuildDocumensoContractHtmlInput): string {
  const values = buildDocumensoContractFieldValues(input);
  let html = loadMasterContractTemplateHtml();

  // Escape và nội suy từng placeholder {{field_name}}
  for (const fieldName of DOCUMENSO_FIELD_NAMES) {
    const escaped = escapeHtml(values[fieldName]);
    const placeholder = `{{${fieldName}}}`;
    html = html.split(placeholder).join(escaped);
  }

  if (input.isDraftPreview) {
    const watermarkHtml = `<div style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;z-index:9999;opacity:0.12;transform:rotate(-32deg);font-size:72px;font-weight:800;letter-spacing:10px;color:#0f172a;text-transform:uppercase;">BẢN NHÁP</div>`;
    html = html.includes('</body>')
      ? html.replace('</body>', `${watermarkHtml}</body>`)
      : `${html}${watermarkHtml}`;
  }

  return html;
}

/** Từ khóa dữ liệu thử nghiệm, khớp theo ranh giới từ (DEMO -, DEMO-NOT-A-...). */
const DEMO_KEYWORD_PATTERN = /\bDEMO\b/i;

/** Email có tên miền thử nghiệm `.invalid` (vd: admin@demo.famidoc.invalid). */
const INVALID_EMAIL_PATTERN = /@[^@\s]+\.invalid\b/i;

export interface RealPartyContractRecipientLike {
  role?: string | null;
  name?: string | null;
  email?: string | null;
}

export interface RealPartyContractValidationResult {
  valid: boolean;
  issues: string[];
}

/**
 * Kiểm tra thông tin định danh/liên hệ của 4 bên trước khi kết xuất PDF hợp đồng thật.
 * Phát hiện chuỗi `DEMO` (tên/mã/địa chỉ) và email tên miền `.invalid` trong thông tin
 * các bên ký hoặc danh sách người ký (recipients) gửi lên Documenso.
 * Hàm thuần: chỉ trả về danh sách vấn đề, việc chặn hay cho phép do guard ở tầng service quyết định.
 */
export function validateRealPartyContractData(
  values: DocumensoContractFieldValues,
  recipients?: ReadonlyArray<RealPartyContractRecipientLike>,
): RealPartyContractValidationResult {
  const issues: string[] = [];

  const checkField = (label: string, raw: string | null | undefined) => {
    const value = (raw ?? '').trim();
    if (!value) return;
    if (INVALID_EMAIL_PATTERN.test(value)) {
      issues.push(`${label}: "${value}" chứa email tên miền thử nghiệm .invalid`);
      return;
    }
    if (DEMO_KEYWORD_PATTERN.test(value)) {
      issues.push(`${label}: "${value}" chứa dữ liệu thử nghiệm (DEMO)`);
    }
  };

  const checkParty = (
    label: string,
    fields: Array<{ field: string; value: string | null | undefined }>,
  ) => {
    for (const field of fields) {
      checkField(`${label} - ${field.field}`, field.value);
    }
  };

  checkParty('Bên A (Đại diện Hộ gia đình)', [
    { field: 'Họ và tên', value: values.party_a_name },
    { field: 'Địa chỉ', value: values.party_a_address },
    { field: 'Điện thoại', value: values.party_a_phone },
    { field: 'Email', value: values.party_a_email },
  ]);
  checkParty('Bên B (Cơ sở y tế)', [
    { field: 'Tên cơ sở', value: values.party_b_facility_name },
    { field: 'Giấy phép KBCB', value: values.party_b_license_number },
    { field: 'Địa chỉ', value: values.party_b_address },
    { field: 'Người đại diện', value: values.party_b_representative },
    { field: 'Liên hệ', value: values.party_b_contact },
  ]);
  checkParty('Bên C (Bác sĩ phụ trách)', [
    { field: 'Họ và tên', value: values.party_c_doctor_name },
    { field: 'Số CCHN/GPHN', value: values.party_c_license_number },
    { field: 'Chuyên khoa', value: values.party_c_specialty },
    { field: 'Liên hệ', value: values.party_c_contact },
  ]);
  checkParty('Bên D (Nền tảng FamiDoc)', [
    { field: 'Tên doanh nghiệp', value: values.party_d_company_name },
    { field: 'Mã số DN', value: values.party_d_tax_code },
    { field: 'Địa chỉ', value: values.party_d_address },
    { field: 'Người đại diện', value: values.party_d_representative },
    { field: 'Liên hệ', value: values.party_d_contact },
  ]);

  for (const recipient of recipients ?? []) {
    const label = `Người ký ${recipient.role || 'không rõ vai trò'}`;
    checkField(`${label} - Tên`, recipient.name);
    checkField(`${label} - Email`, recipient.email);
  }

  return { valid: issues.length === 0, issues };
}

/**
 * Chế độ kiểm tra chủ thể thực tế nghiêm ngặt:
 * - Bật khi `CONTRACT_STRICT_REAL_PARTIES === 'true'`
 * - Hoặc ở production khi `CONTRACT_STRICT_REAL_PARTIES` không đặt `'false'`
 * Khi bật, hệ thống từ chối khởi tạo hợp đồng nếu thông tin các bên còn dữ liệu demo.
 */
export function isStrictRealPartyMode(): boolean {
  const flag = process.env.CONTRACT_STRICT_REAL_PARTIES;
  if (flag === 'true') return true;
  if (flag === 'false') return false;
  return process.env.NODE_ENV === 'production';
}
