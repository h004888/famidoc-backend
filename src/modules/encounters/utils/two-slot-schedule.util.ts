import { EncounterType } from '@prisma/client';

export type SlotWindow = 'MORNING' | 'AFTERNOON';

export const SLOT_WINDOWS: Record<
  SlotWindow,
  {
    key: SlotWindow;
    label: string;
    startTime: string;
    endTime: string;
    startMinutes: number;
    endMinutes: number;
  }
> = {
  MORNING: {
    key: 'MORNING',
    label: 'Khung Sáng (08:00 - 11:30)',
    startTime: '08:00:00',
    endTime: '11:30:00',
    startMinutes: 8 * 60,
    endMinutes: 11 * 60 + 30,
  },
  AFTERNOON: {
    key: 'AFTERNOON',
    label: 'Khung Chiều (13:30 - 17:30)',
    startTime: '13:30:00',
    endTime: '17:30:00',
    startMinutes: 13 * 60 + 30,
    endMinutes: 17 * 60 + 30,
  },
};

export const TELEHEALTH_DEFAULT_DURATION_MINUTES = 45;
export const MIN_CONTINUOUS_GAP_FOR_HOME_VISIT_MINUTES = 120;

const FIXED_VN_HOLIDAYS = new Set(['01-01', '04-30', '05-01', '09-02']);

export function getTimeMinutes(time: Date | string | null | undefined): number {
  if (!time) return 8 * 60;
  if (typeof time === 'string') {
    const parts = time.split(':').map(Number);
    return (parts[0] || 0) * 60 + (parts[1] || 0);
  }
  return time.getUTCHours() * 60 + time.getUTCMinutes();
}

export function mapTimeToSlotWindow(time: Date | string | null | undefined): SlotWindow {
  const minutes = getTimeMinutes(time);
  return minutes < 12 * 60 ? 'MORNING' : 'AFTERNOON';
}

export function slotWindowToScheduledTime(slot: SlotWindow): Date {
  const [h, m, s] = SLOT_WINDOWS[slot].startTime.split(':').map(Number);
  return new Date(Date.UTC(1970, 0, 1, h, m, s || 0, 0));
}

export function isDayOffDate(date: Date): { isDayOff: boolean; reason?: string } {
  if (date.getUTCDay() === 0) {
    return { isDayOff: true, reason: 'Chủ nhật (ngày nghỉ)' };
  }
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  if (FIXED_VN_HOLIDAYS.has(`${mm}-${dd}`)) {
    return { isDayOff: true, reason: 'Ngày nghỉ lễ' };
  }
  return { isDayOff: false };
}

export interface SlotEncounterSummary {
  encounterType: EncounterType | string;
  scheduledTime: Date | string;
  familyLabel?: string | null;
}

export interface SlotAvailabilityResult {
  available: boolean;
  hasTelehealth: boolean;
  maxContinuousGapMinutes: number;
  reason?: string;
  occupiedByLabel?: string | null;
}

export function evaluateSlotWindowAvailability(
  slot: SlotWindow,
  encountersInDay: SlotEncounterSummary[],
): SlotAvailabilityResult {
  const win = SLOT_WINDOWS[slot];
  const inSlot = encountersInDay.filter(
    (e) => mapTimeToSlotWindow(e.scheduledTime) === slot,
  );

  const homeVisit = inSlot.find(
    (e) => e.encounterType !== 'TELEHEALTH' && e.encounterType !== 'TELEMEDICINE',
  );
  if (homeVisit) {
    return {
      available: false,
      hasTelehealth: false,
      maxContinuousGapMinutes: 0,
      reason: `Khung ${slot === 'MORNING' ? 'Sáng' : 'Chiều'} đã có 1 gia đình Khám tại nhà`,
      occupiedByLabel: homeVisit.familyLabel ?? null,
    };
  }

  const telehealthList = inSlot
    .filter((e) => e.encounterType === 'TELEHEALTH' || e.encounterType === 'TELEMEDICINE')
    .map((e) => {
      const start = Math.max(win.startMinutes, getTimeMinutes(e.scheduledTime));
      const end = Math.min(win.endMinutes, start + TELEHEALTH_DEFAULT_DURATION_MINUTES);
      return { start, end };
    })
    .sort((a, b) => a.start - b.start);

  if (telehealthList.length === 0) {
    return {
      available: true,
      hasTelehealth: false,
      maxContinuousGapMinutes: win.endMinutes - win.startMinutes,
    };
  }

  let cursor = win.startMinutes;
  let maxGap = 0;
  for (const item of telehealthList) {
    if (item.start > cursor) {
      maxGap = Math.max(maxGap, item.start - cursor);
    }
    cursor = Math.max(cursor, item.end);
  }
  if (win.endMinutes > cursor) {
    maxGap = Math.max(maxGap, win.endMinutes - cursor);
  }

  const available = maxGap >= MIN_CONTINUOUS_GAP_FOR_HOME_VISIT_MINUTES;
  return {
    available,
    hasTelehealth: true,
    maxContinuousGapMinutes: maxGap,
    reason: available
      ? undefined
      : `Khung ${slot === 'MORNING' ? 'Sáng' : 'Chiều'} có ca Tư vấn Video xen giữa (không đủ 2 giờ liên tục)`,
  };
}

export function buildDayShiftOffsets(maxDays: number): number[] {
  const offsets: number[] = [0];
  for (let d = 1; d <= maxDays; d++) {
    offsets.push(d, -d);
  }
  return offsets;
}
