import {
  addContractMonths,
  missingActivationRequirements,
} from '../activation/contract-activation';

describe('Contract activation helpers', () => {
  it.each([
    ['2026-01-31T01:02:03.000Z', 1, '2026-02-28T01:02:03.000Z'],
    ['2028-01-31T01:02:03.000Z', 1, '2028-02-29T01:02:03.000Z'],
    ['2026-10-27T01:02:03.000Z', 6, '2027-04-27T01:02:03.000Z'],
    ['2028-02-29T01:02:03.000Z', 12, '2029-02-28T01:02:03.000Z'],
  ] as const)(
    'adds calendar months without overflowing the day: %s',
    (start, months, expected) => {
      expect(addContractMonths(new Date(start), months).toISOString()).toBe(
        expected,
      );
    },
  );

  it('lists every missing signature and assignment rather than hiding later prerequisites', () => {
    const missing = missingActivationRequirements({
      familySigned: false,
      adminSigned: false,
      facilitySigned: false,
      doctorSigned: false,
      facilityId: null,
      doctorId: null,
      doctorVerified: false,
      panelCapacityAvailable: false,
    });
    expect(missing).toHaveLength(8);
    expect(missing).toContain('PANEL_CAPACITY_UNAVAILABLE');
  });
});
