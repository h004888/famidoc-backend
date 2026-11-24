import {
  TELEHEALTH_DEFAULT_DURATION_MINUTES,
  VIDEO_CONSULTATION_DURATION_MINUTES,
  evaluateSlotWindowAvailability,
  pickPreferredVideoSlotWindow,
} from '../utils/two-slot-schedule.util';

describe('two-slot-schedule.util (Unified Video 30m & Anti-Fragmentation)', () => {
  it('đồng nhất TELEHEALTH_DEFAULT_DURATION_MINUTES bằng VIDEO_CONSULTATION_DURATION_MINUTES (30 phút)', () => {
    expect(VIDEO_CONSULTATION_DURATION_MINUTES).toBe(30);
    expect(TELEHEALTH_DEFAULT_DURATION_MINUTES).toBe(VIDEO_CONSULTATION_DURATION_MINUTES);
  });

  it('tính chính xác khoảng trống liên tục 180 phút sau 1 ca TELEHEALTH 08:00 (30 phút) trong khung Sáng', () => {
    const res = evaluateSlotWindowAvailability('MORNING', [
      { encounterType: 'TELEHEALTH', scheduledTime: '1970-01-01T08:00:00.000Z' },
    ]);
    expect(res.available).toBe(true);
    expect(res.hasTelehealth).toBe(true);
    expect(res.maxContinuousGapMinutes).toBe(180);
  });

  it('pickPreferredVideoSlotWindow ưu tiên gom ca Video mới vào khung đã có Video nếu khung đó còn chỗ, giữ nguyên khung trống cho HOME_VISIT', () => {
    const encountersInDay = [
      { encounterType: 'TELEHEALTH', scheduledTime: '1970-01-01T08:00:00.000Z' },
    ];
    const preferred = pickPreferredVideoSlotWindow(
      { available: true, candidateTimes: ['08:30', '09:00'] },
      { available: true, candidateTimes: ['13:30', '14:00'] },
      encountersInDay,
    );
    expect(preferred).toBe('MORNING');
  });

  it('pickPreferredVideoSlotWindow chọn khung còn trống nếu khung kia không khả dụng cho Video', () => {
    const preferred = pickPreferredVideoSlotWindow(
      { available: false, candidateTimes: [] },
      { available: true, candidateTimes: ['13:30'] },
      [{ encounterType: 'HOME_VISIT', scheduledTime: '1970-01-01T08:00:00.000Z' }],
    );
    expect(preferred).toBe('AFTERNOON');
  });
});
