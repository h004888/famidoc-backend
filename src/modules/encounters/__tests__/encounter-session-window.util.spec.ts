import {
  computeHomeVisitDeadlines,
  isRecordOverdue,
} from '../utils/encounter-session-window.util';

describe('encounter-session-window.util', () => {
  it('computes MORNING session deadlines for 08:30 / MORNING slot', () => {
    const deadlines = computeHomeVisitDeadlines({
      scheduledDate: new Date('2026-11-25T00:00:00.000Z'),
      scheduledTime: '08:30:00',
      slotWindow: 'MORNING',
    });

    expect(deadlines.sessionWindow).toBe('MORNING');
    expect(deadlines.sessionEndAt.toISOString()).toBe(
      new Date('2026-11-25T11:30:00+07:00').toISOString(),
    );
    expect(deadlines.reminder21hAt.toISOString()).toBe(
      new Date('2026-11-25T21:00:00+07:00').toISOString(),
    );
    expect(deadlines.recordDeadlineAt.toISOString()).toBe(
      new Date('2026-11-25T23:59:59+07:00').toISOString(),
    );
    expect(deadlines.escalationAt.toISOString()).toBe(
      new Date('2026-11-26T23:59:59+07:00').toISOString(),
    );
    expect(deadlines.autoCloseAt.toISOString()).toBe(
      new Date('2026-11-27T11:30:00+07:00').toISOString(),
    );
  });

  it('computes AFTERNOON session deadlines for 14:00 / AFTERNOON slot', () => {
    const deadlines = computeHomeVisitDeadlines({
      scheduledDate: new Date('2026-11-25T00:00:00.000Z'),
      scheduledTime: '14:00:00',
      slotWindow: 'AFTERNOON',
    });

    expect(deadlines.sessionWindow).toBe('AFTERNOON');
    expect(deadlines.sessionEndAt.toISOString()).toBe(
      new Date('2026-11-25T17:30:00+07:00').toISOString(),
    );
    expect(deadlines.reminder21hAt.toISOString()).toBe(
      new Date('2026-11-25T21:00:00+07:00').toISOString(),
    );
    expect(deadlines.recordDeadlineAt.toISOString()).toBe(
      new Date('2026-11-25T23:59:59+07:00').toISOString(),
    );
    expect(deadlines.escalationAt.toISOString()).toBe(
      new Date('2026-11-26T23:59:59+07:00').toISOString(),
    );
    expect(deadlines.autoCloseAt.toISOString()).toBe(
      new Date('2026-11-27T17:30:00+07:00').toISOString(),
    );
  });

  it('evaluates isRecordOverdue accurately at 23:59:59 vs 00:00:00 next day', () => {
    const deadlines = computeHomeVisitDeadlines({
      scheduledDate: '2026-11-25',
      scheduledTime: '09:00:00',
    });

    expect(
      isRecordOverdue(deadlines, new Date('2026-11-25T23:59:59+07:00')),
    ).toBe(false);
    expect(
      isRecordOverdue(deadlines, new Date('2026-11-26T00:00:00+07:00')),
    ).toBe(true);
  });
});
