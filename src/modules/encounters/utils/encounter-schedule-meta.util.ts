import { EncounterCategory, EncounterStatus } from '@prisma/client';

export type PendingScheduleStage =
  | 'CADENCE_DRAFT'
  | 'AWAITING_FAMILY_CONFIRM'
  | 'AWAITING_DOCTOR_REVIEW';

export type EncounterScheduleStage =
  | PendingScheduleStage
  | 'CONFIRMED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED';

export interface EncounterScheduleMeta {
  stage: PendingScheduleStage;
  milestoneIndex?: number;
  totalMilestones?: number;
}

export interface ParsedEncounterScheduleMeta {
  scheduleStage: EncounterScheduleStage;
  milestoneIndex: number | null;
  totalMilestones: number | null;
  displayNotes: string | null;
}

const META_PREFIX_REGEX = /^\[SCHEDULE_META:(\{[^\n]*?\})\]\s*([\s\S]*)$/;
const VALID_PENDING_STAGES: ReadonlySet<string> = new Set([
  'CADENCE_DRAFT',
  'AWAITING_FAMILY_CONFIRM',
  'AWAITING_DOCTOR_REVIEW',
]);

export function stripScheduleMetaPrefix(raw?: string | null): string | null {
  if (!raw) return null;
  const match = META_PREFIX_REGEX.exec(raw);
  const text = (match ? match[2] : raw).trim();
  return text.length > 0 ? text : null;
}

export function serializeEncounterScheduleMeta(
  meta: EncounterScheduleMeta,
  note?: string | null,
): string {
  const payload: EncounterScheduleMeta = {
    stage: meta.stage,
    ...(typeof meta.milestoneIndex === 'number'
      ? { milestoneIndex: meta.milestoneIndex }
      : {}),
    ...(typeof meta.totalMilestones === 'number'
      ? { totalMilestones: meta.totalMilestones }
      : {}),
  };
  const cleanNote = stripScheduleMetaPrefix(note);
  const prefix = `[SCHEDULE_META:${JSON.stringify(payload)}]`;
  return cleanNote ? `${prefix} ${cleanNote}` : prefix;
}

export function parseEncounterScheduleMeta(encounter: {
  encounterStatus: EncounterStatus | string;
  category: EncounterCategory | string;
  cancelReason?: string | null;
}): ParsedEncounterScheduleMeta {
  const raw = encounter.cancelReason ?? null;
  let parsedMeta: Partial<EncounterScheduleMeta> | null = null;
  let displayNotes: string | null = raw ? raw.trim() || null : null;

  if (raw) {
    const match = META_PREFIX_REGEX.exec(raw);
    if (match) {
      try {
        const candidate = JSON.parse(match[1]) as Partial<EncounterScheduleMeta>;
        if (candidate && typeof candidate === 'object') {
          parsedMeta = candidate;
        }
      } catch {
        parsedMeta = null;
      }
      displayNotes = match[2].trim() || null;
    }
  }

  const milestoneIndex =
    typeof parsedMeta?.milestoneIndex === 'number'
      ? parsedMeta.milestoneIndex
      : null;
  const totalMilestones =
    typeof parsedMeta?.totalMilestones === 'number'
      ? parsedMeta.totalMilestones
      : null;

  if (encounter.encounterStatus !== 'REQUESTED') {
    const statusStage = encounter.encounterStatus as EncounterScheduleStage;
    return {
      scheduleStage: statusStage,
      milestoneIndex,
      totalMilestones,
      displayNotes,
    };
  }

  if (parsedMeta?.stage && VALID_PENDING_STAGES.has(parsedMeta.stage)) {
    return {
      scheduleStage: parsedMeta.stage,
      milestoneIndex,
      totalMilestones,
      displayNotes,
    };
  }

  if (encounter.category === 'AD_HOC_ON_DEMAND') {
    return {
      scheduleStage: 'AWAITING_DOCTOR_REVIEW',
      milestoneIndex,
      totalMilestones,
      displayNotes,
    };
  }

  const lower = (raw || '').toLowerCase();
  if (lower.includes('khung dự thảo') || lower.includes('iscadencedraft')) {
    return {
      scheduleStage: 'CADENCE_DRAFT',
      milestoneIndex,
      totalMilestones,
      displayNotes,
    };
  }

  return {
    scheduleStage: 'AWAITING_FAMILY_CONFIRM',
    milestoneIndex,
    totalMilestones,
    displayNotes,
  };
}

export function enrichEncounterWithScheduleMeta<
  T extends {
    encounterStatus: EncounterStatus | string;
    category: EncounterCategory | string;
    cancelReason?: string | null;
  },
>(encounter: T): T & ParsedEncounterScheduleMeta {
  return {
    ...encounter,
    ...parseEncounterScheduleMeta(encounter),
  };
}
