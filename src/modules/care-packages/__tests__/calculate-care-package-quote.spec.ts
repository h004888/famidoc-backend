import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  CarePackageStatus,
  QuotaPeriod,
  type CarePackage,
} from '../entities/care-package.entity';
import { calculateCarePackageQuote } from '../pricing/calculate-care-package-quote';

// Đây là gói giả cho kiểm thử phép tính, không phải giá/quyền lợi nhóm đã chốt.
const makePackage = (overrides: Partial<CarePackage> = {}): CarePackage => ({
  id: '6e672a98-1327-46ed-9ec5-cf9dbbdaf1f9',
  code: 'DEMO_6M',
  version: 1,
  name: 'Demo 6 months',
  description: '',
  durationMonths: 6,
  priceVnd: 1_000_000,
  includedMembers: 4,
  maxMembers: 6,
  additionalMemberMonthlyPriceVnd: 50_000,
  quotaPeriod: QuotaPeriod.PER_TERM,
  quotas: { videoConsultations: 20, homeVisits: 2, facilityVisits: 1 },
  currency: 'VND',
  status: CarePackageStatus.ACTIVE,
  createdAt: '2026-10-26T00:00:00.000Z',
  updatedAt: '2026-10-26T00:00:00.000Z',
  publishedAt: '2026-10-26T00:00:00.000Z',
  retiredAt: null,
  ...overrides,
});

describe('calculateCarePackageQuote', () => {
  it.each([1, 3, 4])(
    'charges the base price for %i members within the included allowance',
    (memberCount) => {
      const quote = calculateCarePackageQuote(makePackage(), memberCount);
      expect(quote.members.additionalCount).toBe(0);
      expect(quote.pricing.additionalMembersTotalVnd).toBe(0);
      expect(quote.pricing.totalPriceVnd).toBe(1_000_000);
    },
  );

  it('charges one additional member for all six months', () => {
    const quote = calculateCarePackageQuote(makePackage(), 5);
    expect(quote.members).toEqual({
      requestedCount: 5,
      includedCount: 4,
      additionalCount: 1,
      maxCount: 6,
    });
    expect(quote.pricing).toEqual({
      currency: 'VND',
      basePriceVnd: 1_000_000,
      additionalMemberMonthlyPriceVnd: 50_000,
      additionalMemberTermPriceVnd: 300_000,
      additionalMembersTotalVnd: 300_000,
      totalPriceVnd: 1_300_000,
    });
  });

  it('charges two additional members without multiplying the base price', () => {
    const quote = calculateCarePackageQuote(makePackage(), 6);
    expect(quote.members.additionalCount).toBe(2);
    expect(quote.pricing.additionalMembersTotalVnd).toBe(600_000);
    expect(quote.pricing.totalPriceVnd).toBe(1_600_000);
  });

  it.each([1, 3, 6, 12])(
    'uses the configured %i-month duration rather than a hardcoded package term',
    (durationMonths) => {
      const quote = calculateCarePackageQuote(
        makePackage({ durationMonths }),
        5,
      );
      expect(quote.package.durationMonths).toBe(durationMonths);
      expect(quote.pricing.totalPriceVnd).toBe(
        1_000_000 + 50_000 * durationMonths,
      );
    },
  );

  it('allows free extra members when the package explicitly configures a zero fee', () => {
    const quote = calculateCarePackageQuote(
      makePackage({ additionalMemberMonthlyPriceVnd: 0 }),
      6,
    );
    expect(quote.members.additionalCount).toBe(2);
    expect(quote.pricing.totalPriceVnd).toBe(1_000_000);
  });

  it('rejects members above the package-specific maximum', () => {
    expect(() => calculateCarePackageQuote(makePackage(), 7)).toThrow(
      BadRequestException,
    );
  });

  it('accepts the included count but not extra members for a fixed-size package', () => {
    const fixed = makePackage({
      maxMembers: 4,
      additionalMemberMonthlyPriceVnd: 0,
    });
    expect(calculateCarePackageQuote(fixed, 4).pricing.totalPriceVnd).toBe(
      1_000_000,
    );
    expect(() => calculateCarePackageQuote(fixed, 5)).toThrow(
      BadRequestException,
    );
  });

  it.each([0, -1, 1.5, 101, NaN, Infinity])(
    'rejects an invalid internal member count: %s',
    (memberCount) => {
      expect(() =>
        calculateCarePackageQuote(makePackage(), memberCount),
      ).toThrow(BadRequestException);
    },
  );

  it.each([CarePackageStatus.DRAFT, CarePackageStatus.DEPRECATED])(
    'refuses a package with status %s',
    (status) => {
      expect(() =>
        calculateCarePackageQuote(makePackage({ status }), 4),
      ).toThrow(NotFoundException);
    },
  );

  it.each([QuotaPeriod.PER_TERM, QuotaPeriod.PER_MONTH])(
    'keeps shared quotas and their %s period unchanged',
    (quotaPeriod) => {
      const source = makePackage({ quotaPeriod });
      const before = structuredClone(source);
      const quote = calculateCarePackageQuote(source, 6);
      expect(quote.benefits).toEqual({
        quotaPeriod,
        quotas: source.quotas,
        sharedAcrossMembers: true,
      });
      expect(source).toEqual(before);
      // Sửa kết quả không được sửa ngược hạn mức gói đang lưu.
      quote.benefits.quotas.videoConsultations = 999;
      expect(source.quotas.videoConsultations).toBe(20);
    },
  );

  it('identifies the source version and does not pretend to create a binding checkout quote', () => {
    const source = makePackage({ version: 3 });
    const quote = calculateCarePackageQuote(source, 4);
    expect(quote).toMatchObject({
      kind: 'NEW_PURCHASE_ESTIMATE',
      binding: false,
      package: {
        id: source.id,
        code: source.code,
        version: 3,
        name: source.name,
        durationMonths: 6,
      },
    });
    expect(Number.isNaN(Date.parse(quote.calculatedAt))).toBe(false);
    expect(quote).not.toHaveProperty('paymentStatus');
    expect(quote).not.toHaveProperty('quoteId');
  });

  it('rejects a result outside the safe JSON integer range instead of rounding money', () => {
    const source = makePackage({
      durationMonths: 120,
      includedMembers: 1,
      maxMembers: 100,
      additionalMemberMonthlyPriceVnd: 1_000_000_000_000,
    });
    expect(() => calculateCarePackageQuote(source, 100)).toThrow(
      BadRequestException,
    );
  });

  it('preserves exact VND amounts within the PostgreSQL DECIMAL limit', () => {
    const source = makePackage({ durationMonths: 12, includedMembers: 1, maxMembers: 6,
      priceVnd: 1_000_001, additionalMemberMonthlyPriceVnd: 100_000_000 });
    const quote = calculateCarePackageQuote(source, 6);
    expect(BigInt(quote.pricing.totalPriceVnd)).toBe(100_000_000n * 12n * 5n + 1_000_001n);
    expect(Number.isSafeInteger(quote.pricing.totalPriceVnd)).toBe(true);
  });
  it('rejects amounts representable by JavaScript but too large for the database', () => {
    const source = makePackage({ priceVnd: 9_999_999_999, includedMembers: 1, maxMembers: 2,
      additionalMemberMonthlyPriceVnd: 1 });
    expect(() => calculateCarePackageQuote(source, 2)).toThrow(BadRequestException);
  });
});
