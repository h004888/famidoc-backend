import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { SignerRole } from '@prisma/client';

/**
 * Thứ tự vai trò chuẩn gửi lên Documenso Envelope (4 recipients).
 * Lưu ý: Bên A (`FAMILY_REP`) ký trước; 3 vai trò còn lại ký song song sau khi Bên A hoàn tất.
 */
export const DOCUMENSO_RECIPIENT_ROLES: readonly SignerRole[] = [
  'FAMILY_REP',
  'HEALTHCARE_FACILITY',
  'ASSIGNED_DOCTOR',
  'ADMIN',
] as const;

export const DOCUMENSO_PARALLEL_ROLES_AFTER_FAMILY: readonly SignerRole[] = [
  'HEALTHCARE_FACILITY',
  'ASSIGNED_DOCTOR',
  'ADMIN',
] as const;

/** Các marker ASCII vô hình dùng làm placeholder chữ ký trên Documenso. */
export const DOCUMENSO_SIGNATURE_MARKERS: Record<SignerRole, string> = {
  FAMILY_REP: '[[SIG_FAMILY_REP]]',
  HEALTHCARE_FACILITY: '[[SIG_HEALTHCARE_FACILITY]]',
  ASSIGNED_DOCTOR: '[[SIG_ASSIGNED_DOCTOR]]',
  ADMIN: '[[SIG_ADMIN]]',
};

export const DOCUMENSO_FIELD_NAMES = [
  'contract_number',
  'created_date_vi',
  'party_a_name',
  'party_a_id_number',
  'party_a_address',
  'party_a_phone',
  'party_a_email',
  'party_b_facility_name',
  'party_b_license_number',
  'party_b_address',
  'party_b_representative',
  'party_b_contact',
  'party_c_doctor_name',
  'party_c_license_number',
  'party_c_specialty',
  'party_c_contact',
  'party_d_company_name',
  'party_d_tax_code',
  'party_d_address',
  'party_d_representative',
  'party_d_contact',
  'package_name',
  'package_code',
  'billing_cycle_label',
  'duration_days',
  'package_entitlements_summary',
  'member_count',
  'included_members',
  'base_price_vnd',
  'extra_members',
  'extra_member_unit_price_vnd',
  'extra_member_total_vnd',
  'total_price_vnd',
  'payment_window_hours',
  'service_area',
  'additional_terms',
] as const;

export type DocumensoContractFieldName = (typeof DOCUMENSO_FIELD_NAMES)[number];

export type DocumensoContractFieldValues = Record<DocumensoContractFieldName, string>;

/**
 * Nạp nội dung HTML của Master Contract Template dù chạy từ `src/` hay `dist/`.
 */
export function loadMasterContractTemplateHtml(): string {
  const candidates = [
    resolve(__dirname, 'four-party-master-contract.html'),
    resolve(
      process.cwd(),
      'src/modules/contracts/templates/four-party-master-contract.html',
    ),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return readFileSync(candidate, 'utf-8');
    }
  }

  throw new Error(
    `Không tìm thấy file Master Contract Template tại: ${candidates.join(', ')}`,
  );
}
