import { resolvePlatformRatePercent } from '../pricing/platform-rate';

const d = (s: string) => new Date(s);
describe('resolvePlatformRatePercent', () => {
  it('defaults to 15 without contracts', () => {
    expect(resolvePlatformRatePercent([], d('2026-05-01'))).toBe(15);
    expect(resolvePlatformRatePercent(undefined, null)).toBe(15);
  });
  it('picks the contract covering the payment date', () => {
    const rows = [
      { platformCommissionRate: '10', startDate: d('2025-01-01'), endDate: d('2025-12-31') },
      { platformCommissionRate: '20', startDate: d('2026-01-01'), endDate: d('2026-12-31') },
    ];
    expect(resolvePlatformRatePercent(rows, d('2025-06-01'))).toBe(10);
    expect(resolvePlatformRatePercent(rows, d('2026-06-01'))).toBe(20);
  });
  it('falls back to the latest contract when none covers the date', () => {
    const rows = [{ platformCommissionRate: '18', startDate: d('2026-01-01'), endDate: d('2026-12-31') }];
    expect(resolvePlatformRatePercent(rows, d('2024-01-01'))).toBe(18);
  });
  it('ignores invalid stored rates', () => {
    const rows = [{ platformCommissionRate: '250', startDate: d('2026-01-01'), endDate: d('2026-12-31') }];
    expect(resolvePlatformRatePercent(rows, d('2026-06-01'))).toBe(15);
  });
});
