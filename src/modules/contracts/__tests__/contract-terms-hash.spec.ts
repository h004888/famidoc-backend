import { calculateContractTermsHash } from '../pricing/contract-terms-hash';
import { createTermsHash } from '../../../core/business/business-helpers';

const contract = {
  id: 'contract-1',
  contractNumber: 'MC-1',
  familyId: 'family-1',
  facilityId: 'facility-1',
  doctorId: 'doctor-1',
  startDate: new Date('2026-10-01T00:00:00Z'),
  endDate: new Date('2027-01-01T00:00:00Z'),
  billingSnapshot: {
    members: { requestedCount: 4 },
    pricing: { totalPriceVnd: 2850000 },
  },
};

describe('Contract acceptance hashes after table consolidation', () => {
  it('preserves the exact hash of a contract signed before moving member rows', () => {
    const original = createTermsHash({
      id: contract.id,
      number: contract.contractNumber,
      familyId: contract.familyId,
      facilityId: contract.facilityId,
      doctorId: contract.doctorId,
      terms: contract.billingSnapshot,
      start: contract.startDate.toISOString(),
      end: contract.endDate.toISOString(),
      members: ['a', 'b'],
    });
    expect(
      calculateContractTermsHash({ ...contract, legacyMemberIds: ['b', 'a'] }),
    ).toBe(original);
  });
  it('keeps the original acceptance when a separately signed addendum increases the purchased count', () => {
    const before = { ...contract, memberCount: 4 };
    const after = { ...before, memberCount: 6 };
    expect(calculateContractTermsHash(after)).toBe(
      calculateContractTermsHash(before),
    );
  });
  it('invalidates an acceptance if the doctor or original purchased terms change', () => {
    const original = calculateContractTermsHash(contract);
    expect(
      calculateContractTermsHash({ ...contract, doctorId: 'doctor-2' }),
    ).not.toBe(original);
    expect(
      calculateContractTermsHash({
        ...contract,
        billingSnapshot: {
          ...contract.billingSnapshot,
          members: { requestedCount: 6 },
        },
      }),
    ).not.toBe(original);
  });
});
