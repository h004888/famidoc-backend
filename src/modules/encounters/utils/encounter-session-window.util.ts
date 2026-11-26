export type HomeVisitSessionWindow = 'MORNING' | 'AFTERNOON';

export interface HomeVisitDeadlines {
  sessionWindow: HomeVisitSessionWindow;
  sessionEndAt: Date;
  reminder21hAt: Date;
  recordDeadlineAt: Date;
  escalationAt: Date;
  autoCloseAt: Date;
}

export interface ComputeHomeVisitDeadlinesInput {
  scheduledDate: Date | string;
  scheduledTime?: Date | string | null;
  slotWindow?: string | null;
}

function extractDateYmd(scheduledDate: Date | string): string {
  if (scheduledDate instanceof Date) {
    return scheduledDate.toISOString().slice(0, 10);
  }
  return String(scheduledDate).trim().slice(0, 10);
}

function extractHour(scheduledTime?: Date | string | null): number {
  if (!scheduledTime) {
    return 8;
  }
  if (scheduledTime instanceof Date) {
    return scheduledTime.getUTCHours();
  }
  const match = /^(\d{1,2})/.exec(String(scheduledTime).trim());
  return match ? Number(match[1]) : 8;
}

export function resolveHomeVisitSessionWindow(
  input: Pick<ComputeHomeVisitDeadlinesInput, 'scheduledTime' | 'slotWindow'>,
): HomeVisitSessionWindow {
  const normalizedSlot = input.slotWindow?.trim().toUpperCase();
  if (normalizedSlot === 'AFTERNOON') {
    return 'AFTERNOON';
  }
  if (normalizedSlot === 'MORNING') {
    return 'MORNING';
  }
  return extractHour(input.scheduledTime) >= 12 ? 'AFTERNOON' : 'MORNING';
}

/**
 * Tính các mốc SLA cho ca khám tại nhà (HOME_VISIT) theo múi giờ +07:00:
 * - Ca Sáng kết thúc 11:30, Ca Chiều kết thúc 17:30
 * - Nhắc 21:00 cùng ngày, hạn chót hồ sơ 23:59:59 cùng ngày
 * - Leo thang 23:59:59 ngày T+1, tự đóng 48h sau hết khung ca
 */
export function computeHomeVisitDeadlines(
  input: ComputeHomeVisitDeadlinesInput,
): HomeVisitDeadlines {
  const dateYmd = extractDateYmd(input.scheduledDate);
  const sessionWindow = resolveHomeVisitSessionWindow(input);
  const sessionEndTime = sessionWindow === 'MORNING' ? '11:30:00' : '17:30:00';

  const sessionEndAt = new Date(`${dateYmd}T${sessionEndTime}+07:00`);
  const reminder21hAt = new Date(`${dateYmd}T21:00:00+07:00`);
  const recordDeadlineAt = new Date(`${dateYmd}T23:59:59+07:00`);
  const escalationAt = new Date(
    recordDeadlineAt.getTime() + 24 * 60 * 60 * 1000,
  );
  const autoCloseAt = new Date(sessionEndAt.getTime() + 48 * 60 * 60 * 1000);

  return {
    sessionWindow,
    sessionEndAt,
    reminder21hAt,
    recordDeadlineAt,
    escalationAt,
    autoCloseAt,
  };
}

export function isRecordOverdue(
  deadlines: Pick<HomeVisitDeadlines, 'recordDeadlineAt'>,
  now: Date = new Date(),
): boolean {
  return now.getTime() > deadlines.recordDeadlineAt.getTime();
}
