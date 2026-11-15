import {
  DOCUMENSO_FIELD_NAMES,
  loadMasterContractTemplateHtml,
} from './documenso-contract-template.schema';
import type { DocumensoContractFieldValues } from './documenso-contract-template.schema';

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

  return {
    contract_number: input.contractNumber,
    created_date_vi: formatDateVi(now),
    party_a_name: rep?.fullName || `Đại diện hộ ${input.family.familyCode || ''}`.trim(),
    party_a_id_number: rep?.citizenId || 'Cập nhật theo hồ sơ xác thực',
    party_a_address: input.family.address || 'Theo hồ sơ hộ gia đình trên FamiDoc',
    party_a_phone: rep?.phone || 'Theo tài khoản FamiDoc',
    party_a_email: rep?.email || 'Chưa cập nhật',
    party_b_facility_name: input.facility.facilityName,
    party_b_license_number: input.facility.licenseNumber || 'Theo hồ sơ GPHĐ Bộ/Sở Y tế',
    party_b_address: input.facility.address || 'Theo hồ sơ cơ sở y tế',
    party_b_representative:
      input.facility.representativeName || facUser?.fullName || input.facility.facilityName,
    party_b_contact:
      [input.facility.phone || facUser?.phone, input.facility.email || facUser?.email]
        .filter(Boolean)
        .join(' | ') || 'Theo hồ sơ cơ sở y tế',
    party_c_doctor_name:
      input.doctor?.doctorName || docUser?.fullName || 'Chờ cơ sở y tế phân công',
    party_c_license_number:
      input.doctor?.licenseNumber || 'Theo chứng chỉ hành nghề xác thực trên FamiDoc',
    party_c_specialty: input.doctor?.specialty || 'Y học gia đình',
    party_c_contact:
      [docUser?.email, docUser?.phone].filter(Boolean).join(' | ') ||
      'Liên hệ qua nền tảng FamiDoc',
    party_d_company_name: 'Nền tảng Y tế Gia đình FamiDoc',
    party_d_tax_code: '0109998888',
    party_d_address: 'Việt Nam (Vận hành trực tuyến tại https://famidoc.online)',
    party_d_representative: input.admin?.fullName || 'Ban Quản trị Nền tảng FamiDoc',
    party_d_contact: input.admin?.email || 'support@famidoc.online',
    package_name: input.pkg.packageName,
    package_code: input.pkg.lineageCode,
    billing_cycle_label: `Chu kỳ ${input.durationMonths} tháng`,
    duration_days: String(Math.max(1, input.durationMonths * 30)),
    package_entitlements_summary: `${input.pkg.periodicVisitsQuota} lượt khám tại nhà, ${input.pkg.telehealthQuota} lượt tư vấn từ xa (telemedicine)`,
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
 * 2. Nội suy đủ 36 biến placeholder vào template HTML
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

  return html;
}
