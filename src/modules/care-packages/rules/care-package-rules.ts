import { HttpStatus } from '@nestjs/common';
import { BaseApiException } from '../../../core/exceptions/api.exception';
import { CarePackageErrorCode } from '../../../core/constants/error-codes.constant';
import { listWorkingDaysInRange } from '../../encounters/utils/two-slot-schedule.util';
import type { CarePackage, CarePackageTerms } from '../entities/care-package.entity';

// Module quy tắc dùng chung cho form admin, API tạo/sửa gói và kiểm tra trước khi publish.
// Mọi con số ngưỡng nằm ở đây để frontend (qua endpoint validate) và backend luôn dùng cùng một bộ quy tắc.

export type CarePackageRuleLevel = 'BLOCK' | 'WARN' | 'INFO';

export interface CarePackageRuleFinding {
  code: string; // S1, S2, S6, P3, V1
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

const formatNumber = (value: number) =>
  value.toLocaleString('vi-VN', { maximumFractionDigits: 1 });

export interface CarePackageLoad {
  totalVisits: number;
  maxTotalVisits: number;
  visitsPerMonth: number;
  doctorUtilization: number;
  level: 'SAFE' | 'WARN' | 'OVER';
}

function durationOf(terms: Pick<CarePackageTerms, 'durationMonths'>): number {
  return Math.max(1, terms.durationMonths ?? 1);
}

export function maxTotalVisitsFor(durationMonths: number): number {
  return SCHEDULING_LIMITS.MAX_VISITS_PER_FAMILY_PER_MONTH * Math.max(1, durationMonths);
}

export function evaluateCarePackageLoad(
  terms: Pick<CarePackageTerms, 'durationMonths' | 'quotas'>,
): CarePackageLoad {
  const months = durationOf(terms);
  const totalVisits = terms.quotas.homeVisits + terms.quotas.videoConsultations;
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

export interface CarePackageRuleContext {
  // Chạy thử xếp lịch 5 gia đình (S6) – bật khi publish/kiểm tra/tạo mới.
  runDryRun?: boolean;
}

export function evaluateCarePackageRules(
  terms: CarePackageTerms,
  context: CarePackageRuleContext = {},
): CarePackageRuleFinding[] {
  const findings: CarePackageRuleFinding[] = [];
  const months = durationOf(terms);

  // ---- A. Điều kiện lượt khám bắt buộc ----
  if (terms.quotas.homeVisits < 1) {
    findings.push({
      code: 'P3',
      level: 'BLOCK',
      message: 'Gói dịch vụ phải có ít nhất 1 lượt khám tại nhà.',
    });
  }
  if (terms.quotas.videoConsultations < 1) {
    findings.push({
      code: 'V1',
      level: 'BLOCK',
      message: 'Tổng số lượt tư vấn video phải lớn hơn 0.',
    });
  }

  // ---- B. Năng lực xếp lịch ----
  const load = evaluateCarePackageLoad(terms);
  if (load.level === 'OVER') {
    findings.push({
      code: 'S1',
      level: 'BLOCK',
      message: `Tổng lượt khám tại nhà và tư vấn video (${load.totalVisits} lượt) vượt trần tối đa ${load.maxTotalVisits} lượt cho gói ${months} tháng (tối đa ${SCHEDULING_LIMITS.MAX_VISITS_PER_FAMILY_PER_MONTH} lượt/tháng/gia đình).`,
    });
  } else if (load.level === 'WARN') {
    findings.push({
      code: 'S2',
      level: 'INFO',
      message: `Tải lịch cao (${formatNumber(load.visitsPerMonth)} lượt/tháng): bác sĩ nhận đủ ${SCHEDULING_LIMITS.MAX_FAMILIES_PER_DOCTOR} gia đình gói này sẽ kín khoảng ~${Math.round(load.doctorUtilization * 100)}% ca làm việc.`,
    });
  }

  findings.push({
    code: 'LOAD',
    level: 'INFO',
    message: `Tải lịch ${formatNumber(load.visitsPerMonth)}/${SCHEDULING_LIMITS.MAX_VISITS_PER_FAMILY_PER_MONTH} lượt/tháng; 1 bác sĩ × ${SCHEDULING_LIMITS.MAX_FAMILIES_PER_DOCTOR} gia đình dùng ${Math.round(load.doctorUtilization * 100)}% ca.`,
  });

  if (context.runDryRun && load.level !== 'OVER' && terms.quotas.homeVisits >= 1 && terms.quotas.videoConsultations >= 1) {
    const dryRun = simulateFullPanel(load.totalVisits, months);
    if (!dryRun.ok) {
      findings.push({
        code: 'S6',
        level: 'BLOCK',
        message: `Không thể xếp đủ lịch cho ${SCHEDULING_LIMITS.MAX_FAMILIES_PER_DOCTOR} gia đình cùng dùng gói này (chỉ xếp được ${dryRun.scheduled}/${dryRun.required} lượt ở kỳ bắt đầu ngày ${dryRun.worstStart}). Vui lòng giảm bớt số lượt khám hoặc tăng thời hạn gói.`,
      });
    }
  }

  return findings;
}

export function blockingFindings(findings: CarePackageRuleFinding[]) {
  return findings.filter((f) => f.level === 'BLOCK');
}

export function assertNoBlockingFindings(findings: CarePackageRuleFinding[]): void {
  const blocking = blockingFindings(findings);
  if (blocking.length > 0) {
    const detail = blocking.map((f) => f.message).join(' ');
    throw new BaseApiException({
      errorCode: CarePackageErrorCode.CARE_PACKAGE_RULE_BLOCKED,
      status: HttpStatus.BAD_REQUEST,
      message: detail,
      detail,
      conditions: blocking.map((f) => ({
        code: f.code,
        condition: `Vi phạm quy tắc ${f.code}`,
        message: f.message,
      })),
    });
  }
}

// ---- S6: chạy thử xếp lịch đủ 5 gia đình cho 1 bác sĩ ----
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

function schedulePanel(dayCount: number, families: number, visits: number): number {
  const shiftsUsed = new Array<number>(dayCount).fill(0);
  let scheduled = 0;
  for (let f = 0; f < families; f += 1) {
    const familyDays = new Set<number>();
    for (let k = 0; k < visits; k += 1) {
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

export interface RemainingCapacityInput {
  remainingVisits: number;
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
    const code = label.startsWith('Nâng gói') ? 'S5' : 'S4';
    const detail = `${label}: còn ${input.remainingVisits} lượt nhưng phần kỳ hạn còn lại chỉ xếp được tối đa ${limit} lượt.`;
    throw new BaseApiException({
      errorCode: CarePackageErrorCode.CARE_PACKAGE_RULE_BLOCKED,
      status: HttpStatus.BAD_REQUEST,
      message: detail,
      detail,
      conditions: [
        {
          code,
          condition: `remainingVisits <= ${limit}`,
          message: `Tối đa ${limit} lượt cho thời gian còn lại của hợp đồng.`,
        },
      ],
    });
  }
}
