import {
  allocateServiceDays,
  calculateMonthlyInvoiceShares,
} from '../pricing/monthly-recognition';
const date = (s: string) => new Date(s + 'T00:00:00Z');
describe('Phân bổ doanh thu theo ngày phục vụ', () => {
  it('gói quý phân bổ qua ba tháng, tổng tiền và tổng 15% không lệch do làm tròn', () => {
    const a = allocateServiceDays(
      2_850_000,
      date('2026-11-01'),
      date('2027-02-01'),
      date('2026-11-01'),
      date('2026-12-01'),
    )!;
    const b = allocateServiceDays(
      2_850_000,
      date('2026-11-01'),
      date('2027-02-01'),
      date('2026-12-01'),
      date('2027-01-01'),
    )!;
    const c = allocateServiceDays(
      2_850_000,
      date('2026-11-01'),
      date('2027-02-01'),
      date('2027-01-01'),
      date('2027-02-01'),
    )!;
    expect([a.grossVnd, b.grossVnd, c.grossVnd]).toEqual([
      929347, 960326, 960327,
    ]);
    expect([a, b, c].reduce((s, x) => s + x.platformFeeVnd, 0)).toBe(427500);
    expect([a, b, c].reduce((s, x) => s + x.facilityShareVnd, 0)).toBe(2422500);
  });
  it('không ghi nhận trước ngày bắt đầu hoặc từ ngày hết hạn', () => {
    expect(
      allocateServiceDays(
        1000,
        date('2026-11-01'),
        date('2026-12-01'),
        date('2026-10-01'),
        date('2026-11-01'),
      ),
    ).toBeNull();
    expect(
      allocateServiceDays(
        1000,
        date('2026-11-01'),
        date('2026-12-01'),
        date('2026-12-01'),
        date('2027-01-01'),
      ),
    ).toBeNull();
  });
  it('phụ lục chỉ phân bổ từ ngày quyền lợi có hiệu lực', () => {
    const invoice = {
      totalPayable: 235000,
      paidAt: new Date('2026-12-14T01:00Z'),
      addendumId: 'addon',
      addendum: { activatedAt: new Date('2026-12-15T01:00Z') },
      contract: {
        startDate: date('2026-11-01'),
        endDate: date('2027-02-01'),
        terminatedAt: null,
      },
    };
    const period = {
      start: new Date('2026-11-30T17:00Z'),
      end: new Date('2026-12-31T17:00Z'),
    };
    expect(
      calculateMonthlyInvoiceShares(invoice, period, date('2027-02-01'))
        ?.grossVnd,
    ).toBe(83229);
  });
  it('ngừng ghi nhận từ ngày chấm dứt, không tự hoàn phần tiền chưa phân bổ', () => {
    const result = allocateServiceDays(
      2_850_000,
      date('2026-11-01'),
      date('2027-02-01'),
      date('2026-11-01'),
      date('2026-12-01'),
      date('2026-11-16'),
    )!;
    expect(result.grossVnd).toBe(464673);
  });
  it('không chia lại hóa đơn đã quyết toán trọn theo cách cũ', () => {
    expect(
      calculateMonthlyInvoiceShares(
        {
          totalPayable: 1000,
          paidAt: date('2026-10-01'),
          addendumId: null,
          contract: {
            startDate: date('2026-10-01'),
            endDate: date('2027-01-01'),
            terminatedAt: null,
          },
          settlementItems: [
            {
              recognitionYear: 2026,
              recognitionMonth: 10,
              recognitionBasis: 'LEGACY_CASH',
              grossAmount: 1000,
              vatAmount: 0,
              netAmount: 1000,
              platformFeeAmount: 150,
              facilityShareAmount: 850,
              serviceFrom: null,
              serviceUntil: null,
            },
          ],
        },
        {
          start: new Date('2026-10-31T17:00Z'),
          end: new Date('2026-11-30T17:00Z'),
        },
      ),
    ).toBeNull();
  });
});
