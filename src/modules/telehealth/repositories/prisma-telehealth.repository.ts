import { Injectable } from '@nestjs/common';
import { EncounterStatus, TelehealthMessage, TelehealthSession } from '@prisma/client';
import { PrismaService } from '../../../core/database/prisma.service';
import {
  ITelehealthRepository,
  TELEHEALTH_ENCOUNTER_INCLUDE,
  TelehealthEncounterRecord,
} from './interfaces/telehealth.repository.interface';

@Injectable()
export class PrismaTelehealthRepository implements ITelehealthRepository {
  constructor(private readonly prisma: PrismaService) {}

  findEncounterForTelehealth(encounterId: string): Promise<TelehealthEncounterRecord | null> {
    return this.prisma.encounter.findUnique({
      where: { id: encounterId },
      include: TELEHEALTH_ENCOUNTER_INCLUDE,
    });
  }

  async upsertSessionAndStartEncounter(params: {
    encounterId: string;
    roomSid: string;
    startedAt: Date;
    shouldStartEncounter: boolean;
  }): Promise<TelehealthSession> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.telehealthSession.findUnique({
        where: { encounterId: params.encounterId },
      });

      const session = existing
        ? existing.startedAt
          ? existing
          : await tx.telehealthSession.update({
              where: { id: existing.id },
              data: { startedAt: params.startedAt },
            })
        : await tx.telehealthSession.create({
            data: {
              encounterId: params.encounterId,
              roomSid: params.roomSid,
              startedAt: params.startedAt,
            },
          });

      if (params.shouldStartEncounter) {
        await tx.encounter.updateMany({
          where: {
            id: params.encounterId,
            encounterStatus: EncounterStatus.CONFIRMED,
          },
          data: {
            encounterStatus: EncounterStatus.IN_PROGRESS,
          },
        });
      }

      return session;
    });
  }

  updateSessionTelemetry(params: {
    sessionId: string;
    networkQualityScore?: string;
    isFallbackChat?: boolean;
  }): Promise<TelehealthSession> {
    return this.prisma.telehealthSession.update({
      where: { id: params.sessionId },
      data: {
        ...(params.networkQualityScore !== undefined
          ? { networkQualityScore: params.networkQualityScore }
          : {}),
        ...(params.isFallbackChat !== undefined ? { isFallbackChat: params.isFallbackChat } : {}),
      },
    });
  }

  async endSessionIdempotent(params: {
    sessionId: string;
    endedAt: Date;
    durationSeconds: number;
  }): Promise<TelehealthSession> {
    await this.prisma.telehealthSession.updateMany({
      where: {
        id: params.sessionId,
        endedAt: null,
      },
      data: {
        endedAt: params.endedAt,
        durationSeconds: params.durationSeconds,
      },
    });

    return this.prisma.telehealthSession.findUniqueOrThrow({
      where: { id: params.sessionId },
    });
  }

  findSessionByRoomSid(roomSid: string): Promise<TelehealthSession | null> {
    return this.prisma.telehealthSession.findUnique({
      where: { roomSid },
    });
  }

  async ensureSessionStartedByRoomSid(
    roomSid: string,
    startedAt: Date,
  ): Promise<TelehealthSession | null> {
    await this.prisma.telehealthSession.updateMany({
      where: {
        roomSid,
        startedAt: null,
      },
      data: {
        startedAt,
      },
    });
    return this.findSessionByRoomSid(roomSid);
  }

  async listMessages(sessionId: string, afterMessageId?: string): Promise<TelehealthMessage[]> {
    if (afterMessageId) {
      const anchor = await this.prisma.telehealthMessage.findFirst({
        where: { id: afterMessageId, sessionId },
        select: { createdAt: true },
      });
      if (anchor) {
        return this.prisma.telehealthMessage.findMany({
          where: {
            sessionId,
            createdAt: { gt: anchor.createdAt },
          },
          orderBy: { createdAt: 'asc' },
        });
      }
    }

    return this.prisma.telehealthMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
    });
  }

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
  }): Promise<TelehealthMessage> {
    return this.prisma.telehealthMessage.create({ data });
  }

  findMessageById(messageId: string): Promise<TelehealthMessage | null> {
    return this.prisma.telehealthMessage.findUnique({
      where: { id: messageId },
    });
  }
}
