import { BadRequestException } from '@nestjs/common';
import { listWorkingDaysInRange } from '../../encounters/utils/two-slot-schedule.util';
import type { CarePackage, CarePackageTerms } from '../entities/care-package.entity';

// Module quy tắc dùng chung cho form admin, API tạo/sửa gói, luồng hợp đồng và kiểm tra trước khi publish.
// Mọi con số ngưỡng nằm ở đây để frontend (qua endpoint validate) và backend luôn dùng cùng một bộ quy tắc.

export type CarePackageRuleLevel = 'BLOCK' | 'WARN' | 'INFO';

export interface CarePackageRuleFinding {
  code: string; // S1..S7 (xếp lịch), P1..P7 (giá)
  level: CarePackageRuleLevel;
  message: string;
}

// Cơ sở: 1 bác sĩ có 2 ca/ngày × 24 ngày làm việc = 48 ca/tháng; giữ 80% cho lịch cố định,
// chia cho tối đa 5 gia đình → 7,68, làm tròn xuống 7 lượt/gia đình/tháng.
export const SCHEDULING_LIMITS = {
  MAX_FAMILIES_PER_DOCTOR: 5,
  DOCTOR_SHIFTS_PER_MONTH: 48,
  MAX_VISITS_PER_FAMILY_PER_MONTH: 7,
  WARN_VISITS_PER_FAMILY_PER_MONTH: 5.5,
} as const;

export const PRICE_LIMITS = {
  HOME_VISIT_UNIT_MIN_VND: 500_000,
  HOME_VISIT_UNIT_MAX_VND: 2_000_000,
  HOME_VISIT_UNIT_REFERENCE_VND: 950_000,
  HOME_VISIT_UNIT_DEVIATION_RATIO: 0.3,
  ADDITIONAL_MEMBER_MIN_VND: 50_000,
  ADDITIONAL_MEMBER_MAX_VND: 150_000,
  VERSION_PRICE_CHANGE_RATIO: 0.2,
} as const;

const formatVnd = (value: number) => `${value.toLocaleString('vi-VN')}đ`;
const formatNumber = (value: number) =>
  value.toLocaleString('vi-VN', { maximumFractionDigits: 1 });

export interface CarePackageLoad {
  totalVisits: number; // lượt nhà + video trọn kỳ (video theo HĐ tính theo mức tối đa cho phép)
  maxTotalVisits: number;
  visitsPerMonth: number;
  doctorUtilization: number; // tỷ lệ ca của 1 bác sĩ khi nhận đủ 5 gia đình gói này
  level: 'SAFE' | 'WARN' | 'OVER';
}

function durationOf(terms: Pick<CarePackageTerms, 'durationMonths'>): number {
  return Math.max(1, terms.durationMonths ?? 1);
}

export function maxTotalVisitsFor(durationMonths: number): number {
  return SCHEDULING_LIMITS.MAX_VISITS_PER_FAMILY_PER_MONTH * Math.max(1, durationMonths);
}

// S3: trần số lượt video thỏa thuận cho gói CONTRACT (Toàn diện 12 tháng 14 lượt nhà → 70).
export function maxContractVideoConsultations(
  terms: Pick<CarePackageTerms, 'durationMonths' | 'quotas'>,
): number {
  return Math.max(0, maxTotalVisitsFor(durationOf(terms)) - terms.quotas.homeVisits);
}

export function evaluateCarePackageLoad(
  terms: Pick<CarePackageTerms, 'durationMonths' | 'quotas' | 'videoQuotaPolicy'>,
  contractVideoConsultations?: number,
): CarePackageLoad {
  const months = durationOf(terms);
  const video =
    terms.videoQuotaPolicy === 'CONTRACT'
      ? (contractVideoConsultations ?? 0)
      : terms.quotas.videoConsultations;
  const totalVisits = terms.quotas.homeVisits + video;
  const visitsPerMonth = totalVisits / months;
  const level =
    visitsPerMonth > SCHEDULING_LIMITS.MAX_VISITS_PER_FAMILY_PER_MONTH
      ? 'OVER'
      : visitsPerMonth > SCHEDULING_LIMITS.WARN_VISITS_PER_FAMILY_PER_MONTH
        ? 'WARN'
        : 'SAFE';
  return {
    totalVisits,
    maxTotalVisits: maxTotalVisitsFor(months),
    visitsPerMonth,
    doctorUtilization:
      (SCHEDULING_LIMITS.MAX_FAMILIES_PER_DOCTOR * visitsPerMonth) /
      SCHEDULING_LIMITS.DOCTOR_SHIFTS_PER_MONTH,
    level,
  };
}

export function effectiveHomeVisitUnitPrice(terms: CarePackageTerms): number | null {
  if (terms.homeVisitUnitPriceVnd !== undefined && terms.homeVisitUnitPriceVnd !== null) {
    return terms.homeVisitUnitPriceVnd;
  }
  return terms.quotas.homeVisits > 0 ? terms.priceVnd / terms.quotas.homeVisits : null;
}

export interface CarePackageRuleContext {
  // Các gói ACTIVE khác (khác mã) để so sánh đơn giá theo kỳ hạn (P4).
  activePackages?: CarePackage[];
  // Phiên bản ACTIVE/trước đó cùng mã để phát hiện thay đổi giá lớn (P6).
  previousVersion?: CarePackage | null;
  // Mã gói đang kiểm tra, để loại chính nó khỏi activePackages.
  code?: string;
  // Chạy thử xếp lịch 5 gia đình (S6) – bật khi publish/kiểm tra.
  runDryRun?: boolean;
}

export function evaluateCarePackageRules(
  terms: CarePackageTerms,
  context: CarePackageRuleContext = {},
): CarePackageRuleFinding[] {
  const findings: CarePackageRuleFinding[] = [];
  const months = durationOf(terms);
  const isContractVideo = terms.videoQuotaPolicy === 'CONTRACT';

  // ---- A. Năng lực xếp lịch ----
  const load = evaluateCarePackageLoad(terms, isContractVideo ? maxContractVideoConsultations(terms) : undefined);
  const ownLoad = evaluateCarePackageLoad(terms);
  if (ownLoad.level === 'OVER') {
    findings.push({
      code: 'S1',
      level: 'BLOCK',
      message: `Tổng lượt khám nhà + video (${ownLoad.totalVisits}) vượt trần ${ownLoad.maxTotalVisits} lượt cho gói ${months} tháng (tối đa ${SCHEDULING_LIMITS.MAX_VISITS_PER_FAMILY_PER_MONTH} lượt/tháng/gia đình).`,
    });
  } else if (ownLoad.level === 'WARN') {
    findings.push({
      code: 'S2',
      level: 'WARN',
      message: `Gói dùng ${formatNumber(ownLoad.visitsPerMonth)} lượt/tháng: bác sĩ nhận đủ ${SCHEDULING_LIMITS.MAX_FAMILIES_PER_DOCTOR} gia đình gói này sẽ kín ~${Math.round(ownLoad.doctorUtilization * 100)}% ca, rất ít chỗ đổi lịch.`,
    });
  }
  if (isContractVideo) {
    const cap = maxContractVideoConsultations(terms);
    if (cap < 1) {
      findings.push({
        code: 'S3',
        level: 'BLOCK',
        message: `Số lượt khám nhà đã dùng hết trần ${maxTotalVisitsFor(months)} lượt, không còn chỗ cho video theo hợp đồng.`,
      });
    } else {
      findings.push({
        code: 'S3',
        level: 'INFO',
        message: `Video theo hợp đồng được thỏa thuận tối đa ${cap} lượt.`,
      });
    }
  }
  findings.push({
    code: 'LOAD',
    level: 'INFO',
    message: `Tải lịch ${formatNumber(load.visitsPerMonth)}/${SCHEDULING_LIMITS.MAX_VISITS_PER_FAMILY_PER_MONTH} lượt/tháng; 1 bác sĩ × ${SCHEDULING_LIMITS.MAX_FAMILIES_PER_DOCTOR} gia đình dùng ${Math.round(load.doctorUtilization * 100)}% ca.`,
  });

  if (context.runDryRun && ownLoad.level !== 'OVER') {
    const totalVisits = isContractVideo ? load.totalVisits : ownLoad.totalVisits;
    const dryRun = simulateFullPanel(totalVisits, months);
    if (!dryRun.ok) {
      findings.push({
        code: 'S6',
        level: 'BLOCK',
        message: `Chạy thử xếp lịch ${SCHEDULING_LIMITS.MAX_FAMILIES_PER_DOCTOR} gia đình cùng mua gói chỉ xếp được ${dryRun.scheduled}/${dryRun.required} lượt (ngày bắt đầu ${dryRun.worstStart}).`,
      });
    }
  }

  // ---- B. Giá ----
  if (terms.quotas.homeVisits < 1) {
    findings.push({
      code: 'P3',
      level: 'BLOCK',
      message: 'Gói phải có ít nhất 1 lượt khám tại nhà vì giá gói = đơn giá × số lượt khám tại nhà.',
    });
  }
  const unit = effectiveHomeVisitUnitPrice(terms);
  if (unit !== null) {
    if (
      unit < PRICE_LIMITS.HOME_VISIT_UNIT_MIN_VND ||
      unit > PRICE_LIMITS.HOME_VISIT_UNIT_MAX_VND
    ) {
      findings.push({
        code: 'P1',
        level: 'BLOCK',
        message: `Đơn giá lượt khám tại nhà ${formatVnd(Math.round(unit))} nằm ngoài khoảng ${formatVnd(PRICE_LIMITS.HOME_VISIT_UNIT_MIN_VND)} – ${formatVnd(PRICE_LIMITS.HOME_VISIT_UNIT_MAX_VND)}.`,
      });
    } else {
      const deviation =
        Math.abs(unit - PRICE_LIMITS.HOME_VISIT_UNIT_REFERENCE_VND) /
        PRICE_LIMITS.HOME_VISIT_UNIT_REFERENCE_VND;
      if (deviation > PRICE_LIMITS.HOME_VISIT_UNIT_DEVIATION_RATIO) {
        findings.push({
          code: 'P2',
          level: 'WARN',
          message: `Đơn giá ${formatVnd(Math.round(unit))} lệch ${Math.round(deviation * 100)}% so với giá tham chiếu ${formatVnd(PRICE_LIMITS.HOME_VISIT_UNIT_REFERENCE_VND)}.`,
        });
      }
    }
    for (const other of context.activePackages ?? []) {
      if (other.code === context.code) continue;
      const otherUnit = effectiveHomeVisitUnitPrice(other);
      if (otherUnit === null) continue;
      const inverted =
        (months > other.durationMonths && unit > otherUnit) ||
        (months < other.durationMonths && unit < otherUnit);
      if (inverted) {
        findings.push({
          code: 'P4',
          level: 'WARN',
          message: `Đơn giá ${formatVnd(Math.round(unit))} (gói ${months} tháng) ngược thứ tự với "${other.name}" ${other.durationMonths} tháng (${formatVnd(Math.round(otherUnit))}): gói dài hơn phải có đơn giá thấp hơn.`,
        });
      }
    }
  }
  if (terms.maxMembers > terms.includedMembers) {
    const fee = terms.additionalMemberMonthlyPriceVnd;
    if (
      fee < PRICE_LIMITS.ADDITIONAL_MEMBER_MIN_VND ||
      fee > PRICE_LIMITS.ADDITIONAL_MEMBER_MAX_VND
    ) {
      findings.push({
        code: 'P5',
        level: 'WARN',
        message: `Phụ phí mỗi người thêm ${formatVnd(fee)}/tháng nằm ngoài khoảng ${formatVnd(PRICE_LIMITS.ADDITIONAL_MEMBER_MIN_VND)} – ${formatVnd(PRICE_LIMITS.ADDITIONAL_MEMBER_MAX_VND)}.`,
      });
    }
  }
  const previous = context.previousVersion;
  if (previous && previous.priceVnd > 0) {
    const change = Math.abs(terms.priceVnd - previous.priceVnd) / previous.priceVnd;
    if (change > PRICE_LIMITS.VERSION_PRICE_CHANGE_RATIO) {
      findings.push({
        code: 'P6',
        level: 'WARN',
        message: `Giá gói đổi ${Math.round(change * 100)}% so với phiên bản ${previous.version} (${formatVnd(previous.priceVnd)} → ${formatVnd(terms.priceVnd)}).`,
      });
    }
  }
  return findings;
}

export function blockingFindings(findings: CarePackageRuleFinding[]) {
  return findings.filter((f) => f.level === 'BLOCK');
}

export function warningFindings(findings: CarePackageRuleFinding[]) {
  return findings.filter((f) => f.level === 'WARN');
}

export function assertNoBlockingFindings(findings: CarePackageRuleFinding[]): void {
  const blocking = blockingFindings(findings);
  if (blocking.length > 0) {
    throw new BadRequestException({
      message: blocking.map((f) => f.message).join(' '),
      code: 'CARE_PACKAGE_RULE_BLOCKED',
      findings: blocking,
    });
  }
}

// ---- S6: chạy thử xếp lịch đủ 5 gia đình cho 1 bác sĩ ----
// Mô hình: 1 ngày 2 ca, 1 ca = 1 gia đình; 1 gia đình tối đa 1 lượt/ngày.
// Thử mọi ngày bắt đầu trong 1 năm (bao gồm các kỳ có ngày lễ) và trả về trường hợp xấu nhất.
export interface PanelDryRunResult {
  ok: boolean;
  required: number;
  scheduled: number;
  worstStart: string;
}

const SHIFTS_PER_DAY = 2;

export function simulateFullPanel(
  visitsPerFamily: number,
  durationMonths: number,
  referenceYear = new Date().getUTCFullYear(),
): PanelDryRunResult {
  const families = SCHEDULING_LIMITS.MAX_FAMILIES_PER_DOCTOR;
  const required = families * visitsPerFamily;
  let worst: PanelDryRunResult = { ok: true, required, scheduled: required, worstStart: '' };
  if (visitsPerFamily <= 0) return worst;
  for (let offset = 0; offset < 366; offset += 1) {
    const start = new Date(Date.UTC(referenceYear, 0, 1 + offset));
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + durationMonths);
    const days = listWorkingDaysInRange(start, end);
    const scheduled = schedulePanel(days.length, families, visitsPerFamily);
    if (scheduled < worst.scheduled) {
      worst = {
        ok: false,
        required,
        scheduled,
        worstStart: start.toISOString().slice(0, 10),
      };
    }
  }
  return worst;
}

// Xếp tham lam: mỗi lượt k của gia đình đặt vào ngày gần ngày lý tưởng nhất còn ca trống.
function schedulePanel(dayCount: number, families: number, visits: number): number {
  const shiftsUsed = new Array<number>(dayCount).fill(0);
  let scheduled = 0;
  for (let f = 0; f < families; f += 1) {
    const familyDays = new Set<number>();
    for (let k = 0; k < visits; k += 1) {
      // Lệch pha giữa các gia đình để không dồn cùng ngày lý tưởng.
      const ideal = Math.floor(((k + (f + 0.5) / families) * dayCount) / visits);
      let placed = false;
      for (let d = 0; d < dayCount && !placed; d += 1) {
        for (const candidate of [ideal + d, ideal - d]) {
          if (
            candidate >= 0 &&
            candidate < dayCount &&
            !familyDays.has(candidate) &&
            shiftsUsed[candidate] < SHIFTS_PER_DAY
          ) {
            familyDays.add(candidate);
            shiftsUsed[candidate] += 1;
            scheduled += 1;
            placed = true;
            break;
          }
        }
      }
    }
  }
  return scheduled;
}

// S4/S5: số lượt còn lại (đã cộng phần mua thêm/nâng gói) phải xếp được trong phần kỳ hạn còn lại.
// Trần = 7 lượt cho mỗi 24 ngày làm việc còn lại (cùng mức ρ 0,8 như S1) và ≤ 1 lượt/ngày.
export interface RemainingCapacityInput {
  remainingVisits: number; // tổng nhà + video còn lại sau thay đổi
  today: Date;
  endDate: Date;
}

export function maxRemainingVisits(today: Date, endDate: Date): number {
  const workingDays = listWorkingDaysInRange(today, endDate).length;
  const byLoad = Math.floor(
    (workingDays * SCHEDULING_LIMITS.MAX_VISITS_PER_FAMILY_PER_MONTH) /
      (SCHEDULING_LIMITS.DOCTOR_SHIFTS_PER_MONTH / 2),
  );
  return Math.min(workingDays, byLoad);
}

export function assertRemainingVisitsFit(input: RemainingCapacityInput, label: string): void {
  const limit = maxRemainingVisits(input.today, input.endDate);
  if (input.remainingVisits > limit) {
    throw new BadRequestException({
      message: `${label}: còn ${input.remainingVisits} lượt nhưng phần kỳ hạn còn lại chỉ xếp được tối đa ${limit} lượt.`,
      code: 'CARE_PACKAGE_RULE_BLOCKED',
      findings: [
        {
          code: label.startsWith('Nâng gói') ? 'S5' : 'S4',
          level: 'BLOCK',
          message: `Tối đa ${limit} lượt cho thời gian còn lại của hợp đồng.`,
        },
      ],
    });
  }
}
