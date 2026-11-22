import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EncounterStatus, EncounterType, TelehealthMessage, TelehealthSession } from '@prisma/client';
import { StorageService } from '../../../core/services/storage.service';
import { validateUploadedDocumentFile } from '../../../core/validation/document-file.validator';
import {
  TELEHEALTH_REPOSITORY_TOKEN,
  type ITelehealthRepository,
  type TelehealthEncounterRecord,
} from '../repositories/interfaces/telehealth.repository.interface';
import { LivekitClientService } from './livekit-client.service';
import { ReportTelemetryDto } from '../dto/telehealth.dto';

export interface TelehealthActor {
  id: string;
  role: string;
  fullName?: string;
}

const ALLOWED_ACTIVE_STATUSES: EncounterStatus[] = [
  EncounterStatus.CONFIRMED,
  EncounterStatus.IN_PROGRESS,
];

@Injectable()
export class TelehealthService {
  constructor(
    @Inject(TELEHEALTH_REPOSITORY_TOKEN)
    private readonly telehealthRepository: ITelehealthRepository,
    private readonly livekitClient: LivekitClientService,
    private readonly storageService: StorageService,
  ) {}

  private buildRoomSid(encounterId: string): string {
    return `telehealth-${encounterId}`;
  }

  private async authorizeEncounterAccess(
    encounterId: string,
    actor: TelehealthActor,
  ): Promise<TelehealthEncounterRecord> {
    const encounter = await this.telehealthRepository.findEncounterForTelehealth(encounterId);
    if (!encounter) {
      throw new NotFoundException('Không tìm thấy buổi khám.');
    }

    const isFamilyRep =
      actor.role === 'FAMILY_REP' &&
      encounter.contract?.familyUnit?.representativeUserId === actor.id;
    const isAssignedDoctor =
      actor.role === 'DOCTOR' && encounter.doctor?.userId === actor.id;

    if (!isFamilyRep && !isAssignedDoctor) {
      throw new ForbiddenException('Bạn không có quyền truy cập phòng khám trực tuyến này.');
    }

    return encounter;
  }

  private assertTelehealthJoinable(encounter: TelehealthEncounterRecord): void {
    if (encounter.encounterType !== EncounterType.TELEHEALTH) {
      throw new BadRequestException('Buổi khám này không phải hình thức Telehealth.');
    }
    if (!ALLOWED_ACTIVE_STATUSES.includes(encounter.encounterStatus)) {
      throw new ConflictException(
        `Không thể tham gia phòng khám khi buổi khám đang ở trạng thái ${encounter.encounterStatus}.`,
      );
    }
  }

  async issueSessionToken(encounterId: string, actor: TelehealthActor) {
    const encounter = await this.authorizeEncounterAccess(encounterId, actor);
    this.assertTelehealthJoinable(encounter);

    const roomSid = encounter.telehealthSession?.roomSid ?? this.buildRoomSid(encounterId);
    const session = await this.telehealthRepository.upsertSessionAndStartEncounter({
      encounterId,
      roomSid,
      startedAt: new Date(),
      shouldStartEncounter: encounter.encounterStatus === EncounterStatus.CONFIRMED,
    });

    const participantIdentity = `${actor.role}:${actor.id}`;
    const displayName =
      actor.fullName?.trim() ||
      (actor.role === 'DOCTOR' ? encounter.doctor?.user?.fullName : 'Đại diện gia đình') ||
      actor.role;

    const token = await this.livekitClient.createParticipantToken({
      roomName: roomSid,
      identity: participantIdentity,
      name: displayName,
      metadata: {
        role: actor.role,
        userId: actor.id,
        encounterId,
      },
    });

    return {
      token,
      url: this.livekitClient.getPublicUrl(),
      roomName: roomSid,
      participantIdentity,
      session,
    };
  }

  async reportTelemetry(
    encounterId: string,
    actor: TelehealthActor,
    dto: ReportTelemetryDto,
  ): Promise<TelehealthSession> {
    const encounter = await this.authorizeEncounterAccess(encounterId, actor);
    if (!encounter.telehealthSession) {
      throw new NotFoundException('Phiên khám trực tuyến chưa được khởi tạo.');
    }

    return this.telehealthRepository.updateSessionTelemetry({
      sessionId: encounter.telehealthSession.id,
      networkQualityScore: dto.networkQualityScore,
      isFallbackChat: dto.isFallbackChat,
    });
  }

  async endSession(encounterId: string, actor: TelehealthActor): Promise<TelehealthSession> {
    const encounter = await this.authorizeEncounterAccess(encounterId, actor);
    if (!encounter.telehealthSession) {
      throw new NotFoundException('Phiên khám trực tuyến chưa được khởi tạo.');
    }

    const session = encounter.telehealthSession;
    if (session.endedAt) {
      return session;
    }

    const endedAt = new Date();
    const startedAt = session.startedAt ?? endedAt;
    const durationSeconds = Math.max(0, Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000));

    return this.telehealthRepository.endSessionIdempotent({
      sessionId: session.id,
      endedAt,
      durationSeconds,
    });
  }

  async handleWebhookEvent(rawBody: string, authHeader?: string): Promise<{ received: boolean }> {
    const event = await this.livekitClient.receiveWebhook(rawBody, authHeader);
    const roomName = event.room?.name;
    if (!roomName) {
      return { received: true };
    }

    if (event.event === 'room_started') {
      await this.telehealthRepository.ensureSessionStartedByRoomSid(roomName, new Date());
    } else if (event.event === 'room_finished') {
      const session = await this.telehealthRepository.findSessionByRoomSid(roomName);
      if (session && !session.endedAt) {
        const endedAt = new Date();
        const startedAt = session.startedAt ?? endedAt;
        const durationSeconds = Math.max(
          0,
          Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000),
        );
        await this.telehealthRepository.endSessionIdempotent({
          sessionId: session.id,
          endedAt,
          durationSeconds,
        });
      }
    }

    return { received: true };
  }

  private async ensureSessionForChat(
    encounterId: string,
    actor: TelehealthActor,
  ): Promise<TelehealthSession> {
    const encounter = await this.authorizeEncounterAccess(encounterId, actor);
    if (encounter.telehealthSession) {
      return encounter.telehealthSession;
    }

    this.assertTelehealthJoinable(encounter);
    return this.telehealthRepository.upsertSessionAndStartEncounter({
      encounterId,
      roomSid: this.buildRoomSid(encounterId),
      startedAt: new Date(),
      shouldStartEncounter: false,
    });
  }

  async listMessages(
    encounterId: string,
    actor: TelehealthActor,
    afterMessageId?: string,
  ): Promise<TelehealthMessage[]> {
    const session = await this.ensureSessionForChat(encounterId, actor);
    return this.telehealthRepository.listMessages(session.id, afterMessageId);
  }

  async sendMessage(
    encounterId: string,
    actor: TelehealthActor,
    rawContent: string,
  ): Promise<TelehealthMessage> {
    const content = rawContent?.trim() ?? '';
    if (content.length < 1 || content.length > 2000) {
      throw new BadRequestException('Nội dung tin nhắn phải từ 1 đến 2000 ký tự.');
    }

    const session = await this.ensureSessionForChat(encounterId, actor);
    const senderName = actor.fullName?.trim() || (actor.role === 'DOCTOR' ? 'Bác sĩ' : 'Gia đình');

    const message = await this.telehealthRepository.createMessage({
      sessionId: session.id,
      senderUserId: actor.id,
      senderRole: actor.role,
      senderName,
      content,
    });

    await this.livekitClient.sendRoomData(session.roomSid, {
      type: 'chat_message_created',
      message,
    });

    return message;
  }

  async uploadAttachment(
    encounterId: string,
    actor: TelehealthActor,
    file: Express.Multer.File | undefined,
    caption?: string,
  ): Promise<TelehealthMessage> {
    if (!file) {
      throw new BadRequestException('Vui lòng chọn tệp đính kèm.');
    }

    const validated = validateUploadedDocumentFile(file);
    const session = await this.ensureSessionForChat(encounterId, actor);
    const senderName = actor.fullName?.trim() || (actor.role === 'DOCTOR' ? 'Bác sĩ' : 'Gia đình');

    const uploadedKey = await this.storageService.uploadFile(
      file,
      `telehealth-attachments/${encounterId}`,
    );

    const message = await this.telehealthRepository.createMessage({
      sessionId: session.id,
      senderUserId: actor.id,
      senderRole: actor.role,
      senderName,
      content: caption?.trim() || null,
      attachmentKey: uploadedKey,
      attachmentName: file.originalname,
      attachmentMimeType: validated.contentType,
      attachmentSizeBytes: file.size,
    });

    await this.livekitClient.sendRoomData(session.roomSid, {
      type: 'chat_message_created',
      message,
    });

    return message;
  }

  async downloadAttachment(
    encounterId: string,
    messageId: string,
    actor: TelehealthActor,
  ): Promise<{ buffer: Buffer; mimeType: string; fileName: string }> {
    const encounter = await this.authorizeEncounterAccess(encounterId, actor);
    const session = encounter.telehealthSession;
    if (!session) {
      throw new NotFoundException('Phiên khám trực tuyến chưa được khởi tạo.');
    }

    const message = await this.telehealthRepository.findMessageById(messageId);
    if (!message || message.sessionId !== session.id || !message.attachmentKey) {
      throw new NotFoundException('Không tìm thấy tệp đính kèm trong phiên khám.');
    }

    const downloaded = await this.storageService.downloadFile(message.attachmentKey);
    return {
      buffer: downloaded.bytes,
      mimeType: message.attachmentMimeType || downloaded.contentType || 'application/octet-stream',
      fileName: message.attachmentName || 'attachment',
    };
  }
}
