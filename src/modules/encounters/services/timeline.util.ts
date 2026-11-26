import { BadRequestException } from '@nestjs/common';

export type TimelineEventType = 'VISIT' | 'PRESCRIPTION' | 'DOCUMENT';

export interface TimelineAttachment {
  id: string;
  name: string;
  downloadAvailable: boolean;
  isImage: boolean;
}

export interface TimelineEvent {
  id: string;
  type: TimelineEventType;
  occurredAt: Date;
  title: string;
  summary: string | null;
  actorName: string | null;
  source: 'CLINICAL' | 'FAMILY_UPLOAD';
  link: { encounterId?: string; documentId?: string };
  canOpenDetail: boolean;
  attachments: TimelineAttachment[];
}

export interface TimelineCursor {
  occurredAt: Date;
  id: string;
}

export function encodeTimelineCursor(cursor: TimelineCursor): string {
  const json = JSON.stringify({
    occurredAt: cursor.occurredAt.toISOString(),
    id: cursor.id,
  });
  return Buffer.from(json).toString('base64url');
}

export function decodeTimelineCursor(cursor?: string): TimelineCursor | null {
  if (cursor === undefined) {
    return null;
  }
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    ) as { occurredAt?: unknown; id?: unknown };
    if (
      typeof parsed?.id !== 'string' ||
      parsed.id.length === 0 ||
      typeof parsed?.occurredAt !== 'string'
    ) {
      throw new BadRequestException('Con trỏ phân trang không hợp lệ.');
    }
    const occurredAt = new Date(parsed.occurredAt);
    if (Number.isNaN(occurredAt.getTime())) {
      throw new BadRequestException('Con trỏ phân trang không hợp lệ.');
    }
    return { occurredAt, id: parsed.id };
  } catch (error) {
    if (error instanceof BadRequestException) {
      throw error;
    }
    throw new BadRequestException('Con trỏ phân trang không hợp lệ.');
  }
}

export function mergeTimelineEvents(
  groups: TimelineEvent[][],
  limit: number,
): { items: TimelineEvent[]; nextCursor: string | null } {
  const sorted = groups.flat().sort((a, b) => {
    const timeDiff = b.occurredAt.getTime() - a.occurredAt.getTime();
    if (timeDiff !== 0) {
      return timeDiff;
    }
    return b.id.localeCompare(a.id);
  });

  const items = sorted.slice(0, limit);
  const last = items[items.length - 1];
  const nextCursor =
    sorted.length > limit && last
      ? encodeTimelineCursor({ occurredAt: last.occurredAt, id: last.id })
      : null;

  return { items, nextCursor };
}

function splitDateTime(date: Date): {
  day: Date;
  time: Date;
  isMidnightUtc: boolean;
} {
  const iso = date.toISOString();
  const timePart = iso.slice(11);
  return {
    day: new Date(`${iso.slice(0, 10)}T00:00:00.000Z`),
    time: new Date(`1970-01-01T${timePart}`),
    isMidnightUtc: timePart === '00:00:00.000Z',
  };
}

export function encounterKeyset(cursor: TimelineCursor | null) {
  if (!cursor) {
    return {};
  }
  const { day, time } = splitDateTime(cursor.occurredAt);
  return {
    OR: [
      { scheduledDate: { lt: day } },
      { scheduledDate: day, scheduledTime: { lt: time } },
      { scheduledDate: day, scheduledTime: time, id: { lt: cursor.id } },
    ],
  };
}

export function dateKeyset(field: string, cursor: TimelineCursor | null) {
  if (!cursor) {
    return {};
  }
  const { day, isMidnightUtc } = splitDateTime(cursor.occurredAt);
  return {
    OR: [
      { [field]: { lt: day } },
      isMidnightUtc
        ? { [field]: day, id: { lt: cursor.id } }
        : { [field]: day },
    ],
  };
}

export function dateTimeKeyset(field: string, cursor: TimelineCursor | null) {
  if (!cursor) {
    return {};
  }
  return {
    OR: [
      { [field]: { lt: cursor.occurredAt } },
      { [field]: cursor.occurredAt, id: { lt: cursor.id } },
    ],
  };
}
