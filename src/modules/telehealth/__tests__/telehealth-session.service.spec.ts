import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { EncounterStatus, EncounterType } from '@prisma/client';
import { StorageService } from '../../../core/services/storage.service';
import { ITelehealthRepository } from '../repositories/interfaces/telehealth.repository.interface';
import { LivekitClientService } from '../services/livekit-client.service';
import { TelehealthService } from '../services/telehealth.service';

describe('TelehealthService - Session Lifecycle', () => {
  let service: TelehealthService;
  let repo: jest.Mocked<ITelehealthRepository>;
  let livekit: jest.Mocked<LivekitClientService>;
  let storage: jest.Mocked<StorageService>;

  const baseEncounter = {
    id: 'enc-1',
    encounterType: EncounterType.TELEHEALTH,
    encounterStatus: EncounterStatus.CONFIRMED,
    contract: {
      familyUnit: { representativeUserId: 'fam-user-1' },
    },
    doctor: {
      userId: 'doc-user-1',
      user: { fullName: 'BS. Minh' },
    },
    telehealthSession: null,
  } as any;

  beforeEach(() => {
    repo = {
      findEncounterForTelehealth: jest.fn(),
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
      createParticipantToken: jest.fn().mockResolvedValue('jwt-token-123'),
      getPublicUrl: jest.fn().mockReturnValue('wss://rtc.famidoc.online'),
      sendRoomData: jest.fn(),
      deleteRoom: jest.fn().mockResolvedValue(undefined),
      receiveWebhook: jest.fn(),
    } as any;
    storage = {
      uploadFile: jest.fn(),
      downloadFile: jest.fn(),
    } as any;

    service = new TelehealthService(repo, livekit, storage);
  });

  it('cấp token cho FAMILY_REP và chuyển CONFIRMED -> IN_PROGRESS', async () => {
    repo.findEncounterForTelehealth.mockResolvedValue(baseEncounter);
    repo.upsertSessionAndStartEncounter.mockResolvedValue({
      id: 'sess-1',
      encounterId: 'enc-1',
      roomSid: 'telehealth-enc-1',
      startedAt: new Date('2026-11-22T08:00:00Z'),
      endedAt: null,
      durationSeconds: 0,
      networkQualityScore: null,
      isFallbackChat: false,
    });

    const result = await service.issueSessionToken('enc-1', {
      id: 'fam-user-1',
      role: 'FAMILY_REP',
      fullName: 'Nguyễn Văn A',
    });

    expect(result.token).toBe('jwt-token-123');
    expect(result.url).toBe('wss://rtc.famidoc.online');
    expect(result.roomName).toBe('telehealth-enc-1');
    expect(repo.upsertSessionAndStartEncounter).toHaveBeenCalledWith(
      expect.objectContaining({
        encounterId: 'enc-1',
        roomSid: 'telehealth-enc-1',
        shouldStartEncounter: true,
      }),
    );
  });

  it('từ chối 404 nếu không tìm thấy encounter', async () => {
    repo.findEncounterForTelehealth.mockResolvedValue(null);
    await expect(
      service.issueSessionToken('missing', { id: 'fam-user-1', role: 'FAMILY_REP' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('từ chối 403 nếu người dùng không thuộc hợp đồng hoặc không phải bác sĩ phụ trách', async () => {
    repo.findEncounterForTelehealth.mockResolvedValue(baseEncounter);
    await expect(
      service.issueSessionToken('enc-1', { id: 'other-user', role: 'FAMILY_REP' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('từ chối 400 nếu encounter không phải TELEHEALTH', async () => {
    repo.findEncounterForTelehealth.mockResolvedValue({
      ...baseEncounter,
      encounterType: EncounterType.HOME_VISIT,
    });
    await expect(
      service.issueSessionToken('enc-1', { id: 'doc-user-1', role: 'DOCTOR' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('từ chối 409 nếu encounter đã COMPLETED hoặc CANCELLED', async () => {
    repo.findEncounterForTelehealth.mockResolvedValue({
      ...baseEncounter,
      encounterStatus: EncounterStatus.COMPLETED,
    });
    await expect(
      service.issueSessionToken('enc-1', { id: 'doc-user-1', role: 'DOCTOR' }),
    ).rejects.toThrow(ConflictException);
  });

  it('kết thúc phiên idempotent và tính durationSeconds', async () => {
    const startedAt = new Date(Date.now() - 65_000);
    repo.findEncounterForTelehealth.mockResolvedValue({
      ...baseEncounter,
      encounterStatus: EncounterStatus.IN_PROGRESS,
      telehealthSession: {
        id: 'sess-1',
        encounterId: 'enc-1',
        roomSid: 'telehealth-enc-1',
        startedAt,
        endedAt: null,
        durationSeconds: 0,
      },
    });
    repo.endSessionIdempotent.mockResolvedValue({
      id: 'sess-1',
      encounterId: 'enc-1',
      roomSid: 'telehealth-enc-1',
      startedAt,
      endedAt: new Date(),
      durationSeconds: 65,
      networkQualityScore: null,
      isFallbackChat: false,
    });

    const ended = await service.endSession('enc-1', { id: 'doc-user-1', role: 'DOCTOR' });
    expect(ended.durationSeconds).toBe(65);
    expect(repo.endSessionIdempotent).toHaveBeenCalled();
  });
});
