import {
  calculateMemberAddendum,
  calculateHomeVisitAddendum,
  type FrozenContractTerms,
} from '../pricing/contract-change-pricing';
const terms = {
  package: { durationMonths: 3 },
  pricing: { basePriceVnd: 2850000, additionalMemberMonthlyPriceVnd: 75000 },
  benefits: { quotaPeriod: 'PER_TERM', quotas: { homeVisits: 3 } },
} as FrozenContractTerms;
describe('Contract change price rules', () => {
  it('uses 950000 VND per quarter-package home visit', () =>
    expect(calculateHomeVisitAddendum(terms, 2)).toBe(1900000));
  it('prorates member fee by remaining service days and rounds the entire sum once', () => {
    expect(
      calculateMemberAddendum(
        terms,
        2,
        new Date('2026-10-01Z'),
        new Date('2027-01-01Z'),
        new Date('2026-11-01Z'),
      ),
    ).toBe(299000);
  });
  it('does not charge for a member place already included in the package', () => {
    expect(
      calculateMemberAddendum(
        terms,
        0,
        new Date('2026-10-01Z'),
        new Date('2027-01-01Z'),
        new Date('2026-11-01Z'),
      ),
    ).toBe(0);
  });
  it('does not create a payable addendum for an expired contract', () => {
    expect(() =>
      calculateMemberAddendum(
        terms,
        1,
        new Date('2026-10-01Z'),
        new Date('2027-01-01Z'),
        new Date('2027-01-01Z'),
      ),
    ).toThrow();
  });
});
