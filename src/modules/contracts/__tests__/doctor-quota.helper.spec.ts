import * as helper from '../pricing/doctor-quota.helper';

describe('doctor-quota.helper — chỉ giới hạn theo số gia đình', () => {
  it('không còn xuất hằng số 40 ca/tháng', () => {
    expect('DOCTOR_USABLE_MONTHLY_HOME_SLOTS' in helper).toBe(false);
  });

  it('4 gia đình dù mỗi gia đình 60 lượt/tháng vẫn nhận thêm được', () => {
    const metrics = helper.computeQuotaMetrics(5, 4);
    expect(metrics.isQuotaFull).toBe(false);
    expect(metrics.remainingSlots).toBe(1);
  });

  it('đủ 5 gia đình thì đầy', () => {
    const metrics = helper.computeQuotaMetrics(5, 5);
    expect(metrics.isQuotaFull).toBe(true);
    expect(metrics.remainingSlots).toBe(0);
  });
});
