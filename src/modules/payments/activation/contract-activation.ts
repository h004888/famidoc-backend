import type { ActivationRequirements } from '../entities/payment.entity';

// Trả danh sách điều kiện còn thiếu, không dùng một cờ "đã trả tiền" để bỏ qua tất cả.
export function missingActivationRequirements(
  requirements: ActivationRequirements,
): string[] {
  const reasons: string[] = [];
  if (!requirements.familySigned) reasons.push('FAMILY_SIGNATURE_REQUIRED');
  if (!requirements.adminSigned) reasons.push('ADMIN_SIGNATURE_REQUIRED');
  if (!requirements.facilitySigned) reasons.push('FACILITY_SIGNATURE_REQUIRED');
  if (!requirements.doctorSigned) reasons.push('DOCTOR_SIGNATURE_REQUIRED');
  if (!requirements.facilityId) reasons.push('FACILITY_ASSIGNMENT_REQUIRED');
  if (!requirements.doctorId) reasons.push('DOCTOR_ASSIGNMENT_REQUIRED');
  if (!requirements.doctorVerified)
    reasons.push('DOCTOR_VERIFICATION_REQUIRED');
  if (!requirements.panelCapacityAvailable)
    reasons.push('PANEL_CAPACITY_UNAVAILABLE');
  if (requirements.contractTermValid === false)
    reasons.push('CONTRACT_TERM_NOT_CURRENT');
  if (requirements.familyCoverageComplete === false)
    reasons.push('ADDITIONAL_FAMILY_MEMBERS_PAYMENT_REQUIRED');
  return reasons;
}

export function addContractMonths(start: Date, months: number): Date {
  // Cộng tháng lịch theo UTC, giữ ngày nếu có; 31/01 + 1 tháng về cuối tháng 02.
  // Đây là quy ước kỹ thuật của bản mô phỏng, cần chốt múi giờ/ngày hiệu lực khi làm hợp đồng thật.
  const result = new Date(start);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}
