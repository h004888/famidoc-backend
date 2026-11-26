import { calculateRevenueShares } from '../pricing/revenue-sharing';
describe('Revenue share arithmetic', () => {
  it('splits 15/85 after subtracting only VAT already recorded on the invoice', () => {
    expect(calculateRevenueShares(1100000, 100000)).toEqual({
      grossVnd: 1100000,
      vatVnd: 100000,
      netVnd: 1000000,
      platformFeeVnd: 150000,
      facilityShareVnd: 850000,
    });
  });
  it('preserves the exact VND total when the percentage is fractional', () => {
    const value = calculateRevenueShares(1001, 0);
    expect(value.platformFeeVnd).toBe(150);
    expect(value.facilityShareVnd).toBe(851);
    expect(value.platformFeeVnd + value.facilityShareVnd + value.vatVnd).toBe(
      value.grossVnd,
    );
  });
  it.each([
    [1.1, 0],
    [-1, 0],
    [100, 101],
    [100, -1],
  ])('rejects invalid recorded amounts %s/%s', (gross, vat) => {
    expect(() => calculateRevenueShares(gross, vat)).toThrow();
  });

  it('uses the contract commission rate instead of the 15% default', () => {
    const value = calculateRevenueShares(1000000, 0, 20);
    expect(value.platformFeeVnd).toBe(200000);
    expect(value.facilityShareVnd).toBe(800000);
  });
  it('supports two-decimal rates without losing VND', () => {
    const value = calculateRevenueShares(1001, 0, 12.5);
    expect(value.platformFeeVnd).toBe(125);
    expect(value.platformFeeVnd + value.facilityShareVnd).toBe(1001);
  });
  it.each([-1, 101, Number.NaN])('rejects invalid rate %s', (rate) => {
    expect(() => calculateRevenueShares(1000, 0, rate)).toThrow();
  });
});
