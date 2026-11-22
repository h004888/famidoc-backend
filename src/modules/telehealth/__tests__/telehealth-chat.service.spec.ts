import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { EncounterStatus, EncounterType } from '@prisma/client';
import { StorageService } from '../../../core/services/storage.service';
import { ITelehealthRepository } from '../repositories/interfaces/telehealth.repository.interface';
import { LivekitClientService } from '../services/livekit-client.service';
import { TelehealthService } from '../services/telehealth.service';

describe('TelehealthService - Persistent Chat', () => {
  let service: TelehealthService;
  let repo: jest.Mocked<ITelehealthRepository>;
  let livekit: jest.Mocked<LivekitClientService>;

  const activeEncounter = {
    id: 'enc-1',
    encounterType: EncounterType.TELEHEALTH,
    encounterStatus: EncounterStatus.IN_PROGRESS,
    contract: { familyUnit: { representativeUserId: 'fam-user-1' } },
    doctor: { userId: 'doc-user-1' },
    telehealthSession: {
      id: 'sess-1',
      encounterId: 'enc-1',
      roomSid: 'telehealth-enc-1',
    },
  } as any;

  beforeEach(() => {
    repo = {
      findEncounterForTelehealth: jest.fn().mockResolvedValue(activeEncounter),
      upsertSessionAndStartEncounter: jest.fn(),
      updateSessionTelemetry: jest.fn(),
      endSessionIdempotent: jest.fn(),
      findSessionByRoomSid: jest.fn(),
      ensureSessionStartedByRoomSid: jest.fn(),
      listMessages: jest.fn(),
      createMessage: jest.fn(),
      findMessageById: jest.fn(),
    };
    livekit = {
      sendRoomData: jest.fn().mockResolvedValue(undefined),
    } as any;

    service = new TelehealthService(repo, livekit, {} as StorageService);
  });

  it('lưu tin nhắn và fan-out chat_message_created qua DataChannel', async () => {
    const saved = {
      id: 'msg-1',
      sessionId: 'sess-1',
      senderUserId: 'fam-user-1',
      senderRole: 'FAMILY_REP',
      senderName: 'Gia đình',
      content: 'Huyết áp 130/85',
      createdAt: new Date(),
    } as any;
    repo.createMessage.mockResolvedValue(saved);

    const res = await service.sendMessage('enc-1', { id: 'fam-user-1', role: 'FAMILY_REP' }, 'Huyết áp 130/85');
    expect(res).toEqual(saved);
    expect(livekit.sendRoomData).toHaveBeenCalledWith('telehealth-enc-1', {
      type: 'chat_message_created',
      message: saved,
    });
  });

  it('từ chối tin nhắn rỗng hoặc vượt quá 2000 ký tự', async () => {
    await expect(
      service.sendMessage('enc-1', { id: 'fam-user-1', role: 'FAMILY_REP' }, '   '),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.sendMessage('enc-1', { id: 'fam-user-1', role: 'FAMILY_REP' }, 'a'.repeat(2001)),
    ).rejects.toThrow(BadRequestException);
  });

  it('chặn truy cập 403 nếu người dùng không thuộc phiên khám', async () => {
    await expect(
      service.listMessages('enc-1', { id: 'intruder', role: 'FAMILY_REP' }),
    ).rejects.toThrow(ForbiddenException);
  });
});
