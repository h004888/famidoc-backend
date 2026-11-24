import {
  evaluateVideoSlotWindowAvailability,
} from '../utils/two-slot-schedule.util';

describe('evaluateVideoSlotWindowAvailability', () => {
  const futureDate = '2099-12-01';

  it('trả về toàn bộ mốc 30 phút khi khung Sáng trống hoàn toàn', () => {
    const res = evaluateVideoSlotWindowAvailability('MORNING', futureDate, []);
    expect(res.available).toBe(true);
    expect(res.candidateTimes).toEqual([
      '08:00',
      '08:30',
      '09:00',
      '09:30',
      '10:00',
      '10:30',
      '11:00',
    ]);
  });

  it('khóa khung Sáng khi đã có lịch Khám tại nhà và áp dụng vùng đệm ±30p sang đầu khung Chiều', () => {
    const encounters = [
      { encounterType: 'HOME_VISIT', scheduledTime: '1970-01-01T08:00:00.000Z' },
    ];
    const morning = evaluateVideoSlotWindowAvailability('MORNING', futureDate, encounters);
    expect(morning.available).toBe(false);
    expect(morning.candidateTimes).toEqual([]);

    const afternoon = evaluateVideoSlotWindowAvailability('AFTERNOON', futureDate, encounters);
    expect(afternoon.available).toBe(true);
    expect(afternoon.candidateTimes[0]).toBe('13:30');
  });

  it('loại bỏ mốc 30 phút đã có ca Video khác hoặc chỗ giữ REQUESTED', () => {
    const encounters = [
      { encounterType: 'TELEHEALTH', scheduledTime: '1970-01-01T09:00:00.000Z' },
    ];
    const morning = evaluateVideoSlotWindowAvailability('MORNING', futureDate, encounters);
    expect(morning.available).toBe(true);
    expect(morning.candidateTimes).not.toContain('09:00');
    expect(morning.candidateTimes).toContain('09:30');
  });

  it('khóa đặt trong ngày khi quá ngưỡng cutoff (sau 09:30 đối với khung Sáng)', () => {
    // 10:00 UTC+7 = 03:00 UTC
    const now = new Date('2026-11-24T03:00:00.000Z');
    const morning = evaluateVideoSlotWindowAvailability('MORNING', '2026-11-24', [], now);
    expect(morning.available).toBe(false);
    expect(morning.reason).toContain('quá giờ đặt trong ngày');
  });
});
