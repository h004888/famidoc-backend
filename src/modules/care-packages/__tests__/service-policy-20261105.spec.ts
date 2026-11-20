import { calculateCarePackageQuote } from '../pricing/calculate-care-package-quote';
import { DoctorTier, resolveDoctorTier } from '../pricing/doctor-pricing';
import {
  CarePackageStatus,
  QuotaPeriod,
  type CarePackage,
} from '../entities/care-package.entity';

function pkg(months = 3): CarePackage {
  const terms = {
    1: {
      includedMembers: 1,
      maxMembers: 2,
      priceVnd: 1_000_000,
      home: 1,
      video: 1,
      unit: 1_000_000,
    },
    3: {
      includedMembers: 3,
      maxMembers: 6,
      priceVnd: 2_850_000,
      home: 3,
      video: 4,
      unit: 950_000,
    },
    6: {
      includedMembers: 4,
      maxMembers: 8,
      priceVnd: 6_475_000,
      home: 7,
      video: 8,
      unit: 925_000,
    },
    12: {
      includedMembers: 6,
      maxMembers: 10,
      priceVnd: 12_600_000,
      home: 14,
      video: 0,
      unit: 900_000,
    },
  }[months]!;
  return {
    id: 'demo',
    code: 'DEMO',
    version: 2,
    name: 'DEMO',
    description: '',
    durationMonths: months,
    ...terms,
    additionalMemberMonthlyPriceVnd: 75_000,
    quotaPeriod: QuotaPeriod.PER_TERM,
    homeVisitUnitPriceVnd: terms.unit,
    videoQuotaPolicy: months === 12 ? 'CONTRACT' : 'FIXED',
    quotas: {
      homeVisits: terms.home,
      videoConsultations: terms.video,
      facilityVisits: 0,
    },
    currency: 'VND',
    status: CarePackageStatus.ACTIVE,
    createdAt: '',
    updatedAt: '',
    publishedAt: null,
    retiredAt: null,
  };
}
describe('Bảng dịch vụ 05/11/2026', () => {
  it.each([
    [1, 1_000_000],
    [3, 2_850_000],
    [6, 6_475_000],
    [12, 12_600_000],
  ])('giữ giá cơ bản gói %i tháng: %i', (months, expected) => {
    const p = pkg(months);
    expect(
      calculateCarePackageQuote(p, p.includedMembers).pricing.totalPriceVnd,
    ).toBe(expected);
  });
  it.each([1, 3, 6, 12])(
    'chấp nhận đúng trần và từ chối vượt trần gói %i tháng',
    (months) => {
      const p = pkg(months);
      expect(
        calculateCarePackageQuote(p, p.maxMembers).members.requestedCount,
      ).toBe(p.maxMembers);
      expect(() => calculateCarePackageQuote(p, p.maxMembers + 1)).toThrow();
    },
  );
  it('Đồng hành 5 người + Tiến sĩ đúng 3.600.000đ, không nhân phụ thu bác sĩ theo người', () => {
    const q = calculateCarePackageQuote(pkg(), 5, {
      doctorTier: DoctorTier.DOCTORATE,
    });
    expect(q.pricing.totalPriceVnd).toBe(3_600_000);
    expect(q.pricing.doctorSurchargeTotalVnd).toBe(300_000);
    expect(q.benefits.quotas).toEqual({
      homeVisits: 3,
      videoConsultations: 4,
      facilityVisits: 0,
    });
  });
  it('mua thêm hai lần khám cộng cả đơn giá gói và phụ thu bác sĩ', () => {
    const q = calculateCarePackageQuote(pkg(), 3, {
      doctorTier: DoctorTier.DOCTORATE,
      extraHomeVisits: 2,
    });
    expect(q.pricing.extraHomeVisitsTotalVnd).toBe(2_100_000);
    expect(q.pricing.totalPriceVnd).toBe(5_250_000);
    expect(q.benefits.quotas.homeVisits).toBe(5);
  });
  it('gói năm chưa chốt video không được hiểu thành không giới hạn', () => {
    expect(
      calculateCarePackageQuote(pkg(12), 6).benefits.videoQuotaConfirmed,
    ).toBe(false);
    expect(
      calculateCarePackageQuote(pkg(12), 6, { videoConsultations: 24 })
        .benefits,
    ).toMatchObject({
      videoQuotaConfirmed: true,
      quotas: { videoConsultations: 24 },
    });
  });
  it.each([0, -1, 1.5, 100001])(
    'từ chối quota thỏa thuận sai: %s',
    (videoConsultations) => {
      expect(() =>
        calculateCarePackageQuote(pkg(12), 6, { videoConsultations }),
      ).toThrow();
    },
  );
  it('không cho tự đổi tám lượt video của gói 6 tháng', () =>
    expect(() =>
      calculateCarePackageQuote(pkg(6), 4, { videoConsultations: 999 }),
    ).toThrow());
  it.each([
    ['Thạc sĩ', DoctorTier.MASTER],
    ['Tiến sĩ', DoctorTier.DOCTORATE],
    ['PGS.TS', DoctorTier.PROFESSOR],
    ['Bác sĩ', DoctorTier.STANDARD],
  ])('nhận diện học hàm %s', (title, tier) =>
    expect(resolveDoctorTier(title)).toBe(tier),
  );
});
