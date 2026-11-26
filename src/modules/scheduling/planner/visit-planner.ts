import {
  isDayOffDate,
  listWorkingDaysInRange,
} from '../../encounters/utils/two-slot-schedule.util';

export type PlannerSlotWindow = 'MORNING' | 'AFTERNOON';
export type PlannerVisitType = 'HOME_VISIT' | 'VIDEO';

export interface PlannedVisit {
  date: string;
  slotWindow: PlannerSlotWindow;
  visitType: PlannerVisitType;
  sequence: number;
}

export interface PlanContractVisitsInput {
  /** Ngày bắt đầu hợp đồng (YYYY-MM-DD, bao gồm). */
  startDate: string;
  /** Ngày kết thúc hợp đồng (YYYY-MM-DD, KHÔNG bao gồm). */
  endDate: string;
  homeVisits: number;
  videoVisits: number;
  occupied: Array<{ date: string; slotWindow: PlannerSlotWindow }>;
  /** Ngày gia đình đã có lượt khác (tối đa 1 lượt/ngày/gia đình). */
  familyBusyDates?: string[];
  /** Không xếp trước ngày này (ví dụ: ngày hôm nay). */
  earliestDate?: string;
}

export type PlanContractVisitsResult =
  | { ok: true; visits: PlannedVisit[] }
  | { ok: false; reason: 'INSUFFICIENT_DAYS'; needed: number; available: number };

const DAY_MS = 86_400_000;

const toIso = (d: Date) => d.toISOString().slice(0, 10);
const parseIso = (s: string) => new Date(`${s}T00:00:00.000Z`);

export interface CandidateDay {
  date: string;
  /** Số ngày lịch tính từ đầu khoảng lập kế hoạch. */
  offset: number;
  freeWindows: PlannerSlotWindow[];
}

/**
 * Ứng viên = ngày làm việc trong [max(start, earliest), end) còn ≥1 ca trống
 * và gia đình chưa có lượt nào trong ngày đó.
 */
export function buildCandidateDays(
  input: Pick<
    PlanContractVisitsInput,
    'startDate' | 'endDate' | 'occupied' | 'familyBusyDates' | 'earliestDate'
  >,
): { candidates: CandidateDay[]; rangeDays: number } {
  const effectiveStart =
    input.earliestDate && input.earliestDate > input.startDate
      ? input.earliestDate
      : input.startDate;
  const start = parseIso(effectiveStart);
  const end = parseIso(input.endDate);
  const rangeDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY_MS));

  const takenByDate = new Map<string, Set<PlannerSlotWindow>>();
  for (const o of input.occupied) {
    const set = takenByDate.get(o.date) ?? new Set<PlannerSlotWindow>();
    set.add(o.slotWindow);
    takenByDate.set(o.date, set);
  }
  const busy = new Set(input.familyBusyDates ?? []);

  const candidates: CandidateDay[] = [];
  for (const day of listWorkingDaysInRange(start, end)) {
    if (isDayOffDate(day).isDayOff) continue;
    const date = toIso(day);
    if (busy.has(date)) continue;
    const taken = takenByDate.get(date);
    const freeWindows = (['MORNING', 'AFTERNOON'] as const).filter(
      (w) => !taken?.has(w),
    );
    if (freeWindows.length === 0) continue;
    candidates.push({
      date,
      offset: Math.round((day.getTime() - start.getTime()) / DAY_MS),
      freeWindows,
    });
  }
  return { candidates, rangeDays };
}

/**
 * Chọn N ngày (tăng dần) sao cho tổng |ngày - ngày lý tưởng| nhỏ nhất.
 * dp[i][j] = min(dp[i][j-1], dp[i-1][j-1] + |a_j - t_i|), độ phức tạp O(N·M).
 */
export function pickDaysByDp(
  offsets: number[],
  count: number,
  rangeDays: number,
): number[] {
  const m = offsets.length;
  const ideal = Array.from(
    { length: count },
    (_, k) => ((k + 0.5) * rangeDays) / count,
  );
  const INF = Number.POSITIVE_INFINITY;
  const dp: number[][] = Array.from({ length: count + 1 }, () =>
    new Array<number>(m + 1).fill(INF),
  );
  const take: boolean[][] = Array.from({ length: count + 1 }, () =>
    new Array<boolean>(m + 1).fill(false),
  );
  for (let j = 0; j <= m; j++) dp[0][j] = 0;
  for (let i = 1; i <= count; i++) {
    for (let j = 1; j <= m; j++) {
      const skip = dp[i][j - 1];
      const use = dp[i - 1][j - 1] + Math.abs(offsets[j - 1] - ideal[i - 1]);
      if (use < skip) {
        dp[i][j] = use;
        take[i][j] = true;
      } else {
        dp[i][j] = skip;
      }
    }
  }
  const picked: number[] = [];
  let i = count;
  let j = m;
  while (i > 0 && j > 0) {
    if (take[i][j]) {
      picked.push(j - 1);
      i--;
    }
    j--;
  }
  return picked.reverse();
}

export function planContractVisits(
  input: PlanContractVisitsInput,
): PlanContractVisitsResult {
  const total = input.homeVisits + input.videoVisits;
  if (total === 0) return { ok: true, visits: [] };

  const { candidates, rangeDays } = buildCandidateDays(input);
  if (candidates.length < total) {
    return {
      ok: false,
      reason: 'INSUFFICIENT_DAYS',
      needed: total,
      available: candidates.length,
    };
  }

  const pickedIdx = pickDaysByDp(
    candidates.map((c) => c.offset),
    total,
    rangeDays,
  );

  const visits: PlannedVisit[] = pickedIdx.map((candidateIdx, k) => {
    const candidate = candidates[candidateIdx];
    const isHome =
      Math.floor(((k + 1) * input.homeVisits) / total) >
      Math.floor((k * input.homeVisits) / total);
    return {
      date: candidate.date,
      slotWindow: candidate.freeWindows.includes('MORNING')
        ? 'MORNING'
        : 'AFTERNOON',
      visitType: isHome ? 'HOME_VISIT' : 'VIDEO',
      sequence: k + 1,
    };
  });
  return { ok: true, visits };
}
