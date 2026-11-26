import { buildBackfillRows } from '../../../../scripts/backfill-slot-bookings';

describe('buildBackfillRows', () => {
  const todayIso = '2026-11-26';

  const makeEnc = (overrides: Record<string, unknown> = {}) => ({
    id: 'enc-1',
    doctorId: 'doc-1',
    contractId: 'con-1',
    encounterType: 'HOME_VISIT',
    encounterStatus: 'CONFIRMED',
    scheduledDate: new Date('2026-12-01T00:00:00.000Z'),
    scheduledTime: new Date('1970-01-01T09:00:00.000Z'),
    slotWindow: null as string | null,
    createdAt: new Date('2026-11-20T08:00:00.000Z'),
    ...overrides,
  });

  it('(a)(b) suy ra slotWindow từ scheduledTime khi slotWindow=null (09:00 -> MORNING, 14:00 -> AFTERNOON)', () => {
    const { rows, conflicts, slotWindowUpdates } = buildBackfillRows(
      [
        makeEnc({ id: 'enc-am', scheduledTime: new Date('1970-01-01T09:00:00.000Z') }),
        makeEnc({
          id: 'enc-pm',
          contractId: 'con-2',
          scheduledDate: new Date('2026-12-02T00:00:00.000Z'),
          scheduledTime: new Date('1970-01-01T14:00:00.000Z'),
        }),
      ],
      todayIso,
    );

    expect(conflicts).toHaveLength(0);
    expect(rows).toEqual([
      expect.objectContaining({ encounterId: 'enc-am', slotWindow: 'MORNING', status: 'BOOKED' }),
      expect.objectContaining({ encounterId: 'enc-pm', slotWindow: 'AFTERNOON', status: 'BOOKED' }),
    ]);
    expect(slotWindowUpdates).toEqual([
      { id: 'enc-am', slotWindow: 'MORNING' },
      { id: 'enc-pm', slotWindow: 'AFTERNOON' },
    ]);
  });

  it('(c) 2 encounter khác hợp đồng cùng (doctor, ngày, ca) → giữ bản ghi createdAt sớm hơn, bản ghi sau vào conflicts', () => {
    const { rows, conflicts } = buildBackfillRows(
      [
        makeEnc({
          id: 'enc-later',
          contractId: 'con-2',
          createdAt: new Date('2026-11-21T09:00:00.000Z'),
        }),
        makeEnc({
          id: 'enc-earlier',
          contractId: 'con-1',
          createdAt: new Date('2026-11-20T09:00:00.000Z'),
        }),
      ],
      todayIso,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].encounterId).toBe('enc-earlier');
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ encounterId: 'enc-later', reason: 'SLOT_CONFLICT' });
  });

  it('(d) bỏ qua encounter CANCELLED/COMPLETED hoặc ngày quá khứ', () => {
    const { rows, conflicts } = buildBackfillRows(
      [
        makeEnc({ id: 'enc-cancelled', encounterStatus: 'CANCELLED' }),
        makeEnc({ id: 'enc-completed', encounterStatus: 'COMPLETED' }),
        makeEnc({ id: 'enc-past', scheduledDate: new Date('2026-11-25T00:00:00.000Z') }),
      ],
      todayIso,
    );

    expect(rows).toHaveLength(0);
    expect(conflicts).toHaveLength(0);
  });

  it('(e) 2 encounter cùng hợp đồng cùng ngày → cái sau vào conflicts', () => {
    const { rows, conflicts } = buildBackfillRows(
      [
        makeEnc({
          id: 'enc-1',
          slotWindow: 'MORNING',
          createdAt: new Date('2026-11-20T08:00:00.000Z'),
        }),
        makeEnc({
          id: 'enc-2',
          slotWindow: 'AFTERNOON',
          scheduledTime: new Date('1970-01-01T14:00:00.000Z'),
          createdAt: new Date('2026-11-20T09:00:00.000Z'),
        }),
      ],
      todayIso,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].encounterId).toBe('enc-1');
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ encounterId: 'enc-2', reason: 'CONTRACT_SAME_DAY' });
  });
});
