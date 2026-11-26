import { BadRequestException } from '@nestjs/common';
import {
  dateKeyset,
  dateTimeKeyset,
  decodeTimelineCursor,
  encodeTimelineCursor,
  encounterKeyset,
  mergeTimelineEvents,
  TimelineEvent,
} from '../services/timeline.util';

describe('timeline.util', () => {
  describe('encodeTimelineCursor / decodeTimelineCursor', () => {
    it('encodes and decodes a valid cursor', () => {
      const input = {
        occurredAt: new Date('2026-11-20T08:30:00.000Z'),
        id: 'a1',
      };
      const encoded = encodeTimelineCursor(input);
      const decoded = decodeTimelineCursor(encoded);

      expect(decoded).not.toBeNull();
      expect(decoded!.occurredAt.toISOString()).toBe('2026-11-20T08:30:00.000Z');
      expect(decoded!.id).toBe('a1');
    });

    it('returns null when cursor is undefined', () => {
      expect(decodeTimelineCursor(undefined)).toBeNull();
    });

    it('throws BadRequestException for invalid cursor strings', () => {
      const badDate = Buffer.from(
        JSON.stringify({ occurredAt: 'abc', id: 'x' }),
      ).toString('base64url');
      const missingId = Buffer.from(
        JSON.stringify({ occurredAt: '2026-11-20T08:30:00.000Z' }),
      ).toString('base64url');

      for (const bad of ['khong-hop-le', badDate, missingId]) {
        expect(() => decodeTimelineCursor(bad)).toThrow(BadRequestException);
        expect(() => decodeTimelineCursor(bad)).toThrow(
          'Con trỏ phân trang không hợp lệ.',
        );
      }
    });
  });

  describe('mergeTimelineEvents', () => {
    const makeEvent = (
      id: string,
      type: TimelineEvent['type'],
      iso: string,
    ): TimelineEvent => ({
      id,
      type,
      occurredAt: new Date(iso),
      title: id,
      summary: null,
      actorName: null,
      source: type === 'DOCUMENT' ? 'FAMILY_UPLOAD' : 'CLINICAL',
      link: {},
      canOpenDetail: type !== 'DOCUMENT',
      attachments: [],
    });

    it('merges, sorts descending by occurredAt then id, slices to limit, and returns nextCursor', () => {
      const visits = [makeEvent('v1', 'VISIT', '2026-11-20T08:30:00.000Z')];
      const prescriptions = [
        makeEvent('p1', 'PRESCRIPTION', '2026-11-21T02:00:00.000Z'),
      ];
      const documents = [
        makeEvent('d1', 'DOCUMENT', '2026-11-19T00:00:00.000Z'),
        makeEvent('d9', 'DOCUMENT', '2026-11-20T08:30:00.000Z'),
      ];

      const page = mergeTimelineEvents([visits, prescriptions, documents], 3);
      expect(page.items.map((item) => item.id)).toEqual(['p1', 'v1', 'd9']);
      expect(page.nextCursor).toBe(
        encodeTimelineCursor({
          occurredAt: new Date('2026-11-20T08:30:00.000Z'),
          id: 'd9',
        }),
      );

      const full = mergeTimelineEvents([visits, prescriptions, documents], 10);
      expect(full.items).toHaveLength(4);
      expect(full.nextCursor).toBeNull();
    });

    it('returns empty items and null nextCursor for empty groups', () => {
      expect(mergeTimelineEvents([[], [], []], 20)).toEqual({
        items: [],
        nextCursor: null,
      });
    });
  });

  describe('keyset builders', () => {
    const cursor = {
      occurredAt: new Date('2026-11-20T08:30:00.000Z'),
      id: 'v1',
    };
    const day = new Date('2026-11-20T00:00:00.000Z');
    const time = new Date('1970-01-01T08:30:00.000Z');

    it('returns empty object when cursor is null', () => {
      expect(encounterKeyset(null)).toEqual({});
      expect(dateKeyset('recordedDate', null)).toEqual({});
      expect(dateTimeKeyset('createdAt', null)).toEqual({});
    });

    it('builds encounterKeyset', () => {
      expect(encounterKeyset(cursor)).toEqual({
        OR: [
          { scheduledDate: { lt: day } },
          { scheduledDate: day, scheduledTime: { lt: time } },
          { scheduledDate: day, scheduledTime: time, id: { lt: 'v1' } },
        ],
      });
    });

    it('builds dateKeyset for non-midnight and midnight cursors', () => {
      expect(dateKeyset('recordedDate', cursor)).toEqual({
        OR: [{ recordedDate: { lt: day } }, { recordedDate: day }],
      });

      expect(
        dateKeyset('recordedDate', {
          occurredAt: new Date('2026-11-20T00:00:00.000Z'),
          id: 'd5',
        }),
      ).toEqual({
        OR: [
          { recordedDate: { lt: day } },
          { recordedDate: day, id: { lt: 'd5' } },
        ],
      });
    });

    it('builds dateTimeKeyset', () => {
      expect(dateTimeKeyset('createdAt', cursor)).toEqual({
        OR: [
          { createdAt: { lt: cursor.occurredAt } },
          { createdAt: cursor.occurredAt, id: { lt: 'v1' } },
        ],
      });
    });
  });
});
