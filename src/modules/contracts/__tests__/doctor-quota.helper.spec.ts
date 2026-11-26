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

  it('buildActiveAndHeldWhere: bao gồm PENDING_ACTIVATION (không đếm trùng khi source đang ACTIVE) và loại trừ PENDING_PAYMENT của kỳ gia hạn nối tiếp', () => {
    const now = new Date('2026-11-26T05:00:00.000Z');
    const where = helper.buildActiveAndHeldWhere('doc-1', { now });
    expect(where.doctorId).toBe('doc-1');
    expect(Array.isArray(where.OR)).toBe(true);
    expect(where.OR).toEqual(
      expect.arrayContaining([
        { contractStatus: 'ACTIVE' },
        {
          contractStatus: 'PENDING_ACTIVATION',
          OR: [
            { upgradedFromId: null },
            { upgradedFrom: { contractStatus: { not: 'ACTIVE' } } },
          ],
        },
        expect.objectContaining({
          contractStatus: { in: ['PENDING_APPROVAL', 'PENDING_PAYMENT'] },
          AND: expect.arrayContaining([
            { OR: [{ holdExpiresAt: null }, { holdExpiresAt: { gt: now } }] },
            {
              OR: [
                { upgradedFromId: null },
                { upgradedFrom: { contractStatus: { not: 'ACTIVE' } } },
              ],
            },
          ]),
        }),
      ]),
    );
  });
});
