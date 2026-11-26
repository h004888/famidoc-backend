import { planContractVisits } from '../planner/visit-planner';

const dayDiff = (a: string, b: string) =>
  Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

describe('planContractVisits', () => {
  const base = {
    startDate: '2026-12-01',
    endDate: '2027-01-01',
    homeVisits: 2,
    videoVisits: 2,
    occupied: [] as Array<{
      date: string;
      slotWindow: 'MORNING' | 'AFTERNOON';
    }>,
  };

  it('rải đều, xen kẽ video/khám nhà, tránh Chủ nhật và ngày lễ', () => {
    const result = planContractVisits(base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.visits).toHaveLength(4);
    const dates = result.visits.map((v) => v.date);
    expect([...dates].sort()).toEqual(dates);
    for (let i = 1; i < dates.length; i++) {
      const gap = dayDiff(dates[i - 1], dates[i]);
      expect(gap).toBeGreaterThanOrEqual(5);
      expect(gap).toBeLessThanOrEqual(10);
    }
    for (const d of dates) {
      expect(new Date(`${d}T00:00:00Z`).getUTCDay()).not.toBe(0);
    }
    expect(result.visits.map((v) => v.visitType)).toEqual([
      'VIDEO',
      'HOME_VISIT',
      'VIDEO',
      'HOME_VISIT',
    ]);
    expect(result.visits.map((v) => v.sequence)).toEqual([1, 2, 3, 4]);
  });

  it('bỏ qua ngày mà cả 2 ca đều bị chiếm', () => {
    const result = planContractVisits({
      ...base,
      occupied: [
        { date: '2026-12-02', slotWindow: 'MORNING' },
        { date: '2026-12-02', slotWindow: 'AFTERNOON' },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.visits.map((v) => v.date)).not.toContain('2026-12-02');
  });

  it('ca sáng bị chiếm thì chọn ca chiều', () => {
    const result = planContractVisits({
      startDate: '2026-12-03',
      endDate: '2026-12-04',
      homeVisits: 1,
      videoVisits: 0,
      occupied: [{ date: '2026-12-03', slotWindow: 'MORNING' }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.visits).toEqual([
      expect.objectContaining({
        date: '2026-12-03',
        slotWindow: 'AFTERNOON',
        visitType: 'HOME_VISIT',
      }),
    ]);
  });

  it('không đủ ngày làm việc → INSUFFICIENT_DAYS', () => {
    const result = planContractVisits({
      startDate: '2026-12-01',
      endDate: '2026-12-31',
      homeVisits: 15,
      videoVisits: 15,
      occupied: [],
    });
    expect(result).toEqual({
      ok: false,
      reason: 'INSUFFICIENT_DAYS',
      needed: 30,
      available: 26,
    });
  });

  it('không có 2 lượt cùng ngày', () => {
    const result = planContractVisits({
      ...base,
      homeVisits: 10,
      videoVisits: 10,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const dates = result.visits.map((v) => v.date);
    expect(new Set(dates).size).toBe(dates.length);
  });

  it('earliestDate sau startDate → mọi lượt ≥ earliestDate', () => {
    const result = planContractVisits({ ...base, earliestDate: '2026-12-15' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const v of result.visits) {
      expect(v.date >= '2026-12-15').toBe(true);
    }
  });

  it('familyBusyDates bị loại khỏi ứng viên', () => {
    const result = planContractVisits({
      ...base,
      familyBusyDates: ['2026-12-08', '2026-12-09'],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const dates = result.visits.map((v) => v.date);
    expect(dates).not.toContain('2026-12-08');
    expect(dates).not.toContain('2026-12-09');
  });
});
