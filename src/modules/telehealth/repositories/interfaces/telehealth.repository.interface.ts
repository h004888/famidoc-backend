import { Prisma, TelehealthMessage, TelehealthSession } from '@prisma/client';

export const TELEHEALTH_ENCOUNTER_INCLUDE = {
  contract: {
    include: {
      familyUnit: true,
    },
  },
  doctor: {
    include: {
      user: true,
    },
  },
  telehealthSession: true,
} as const;

export type TelehealthEncounterRecord = Prisma.EncounterGetPayload<{
  include: typeof TELEHEALTH_ENCOUNTER_INCLUDE;
}>;

export const TELEHEALTH_REPOSITORY_TOKEN = Symbol('ITelehealthRepository');

export interface ITelehealthRepository {
  findEncounterForTelehealth(encounterId: string): Promise<TelehealthEncounterRecord | null>;
  upsertSessionAndStartEncounter(params: {
    encounterId: string;
    roomSid: string;
    startedAt: Date;
    shouldStartEncounter: boolean;
    actorRole?: string;
    joinedAt?: Date;
  }): Promise<TelehealthSession>;
  updateSessionTelemetry(params: {
    sessionId: string;
    networkQualityScore?: string;
    isFallbackChat?: boolean;
  }): Promise<TelehealthSession>;
  endSessionIdempotent(params: {
    sessionId: string;
    endedAt: Date;
    durationSeconds: number;
    closedByRole?: string;
    transitionToWrapUp?: boolean;
  }): Promise<TelehealthSession>;
  findSessionByRoomSid(roomSid: string): Promise<TelehealthSession | null>;
  ensureSessionStartedByRoomSid(roomSid: string, startedAt: Date): Promise<TelehealthSession | null>;
  listMessages(sessionId: string, afterMessageId?: string): Promise<TelehealthMessage[]>;
  createMessage(data: {
    sessionId: string;
    senderUserId: string;
    senderRole: string;
    senderName: string;
    content?: string | null;
    attachmentKey?: string | null;
    attachmentName?: string | null;
    attachmentMimeType?: string | null;
    attachmentSizeBytes?: number | null;
  }): Promise<TelehealthMessage>;
  findMessageById(messageId: string): Promise<TelehealthMessage | null>;
}
