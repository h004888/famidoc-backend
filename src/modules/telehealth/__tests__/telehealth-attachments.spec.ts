import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { EncounterStatus, EncounterType } from '@prisma/client';
import { StorageService } from '../../../core/services/storage.service';
import { ITelehealthRepository } from '../repositories/interfaces/telehealth.repository.interface';
import { LivekitClientService } from '../services/livekit-client.service';
import { TelehealthService } from '../services/telehealth.service';

describe('TelehealthService - Attachments', () => {
  let service: TelehealthService;
  let repo: jest.Mocked<ITelehealthRepository>;
  let livekit: jest.Mocked<LivekitClientService>;
  let storage: jest.Mocked<StorageService>;

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
    storage = {
      uploadFile: jest.fn().mockResolvedValue('telehealth-attachments/enc-1/bp.png'),
      downloadFile: jest.fn().mockResolvedValue({
        bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
        contentType: 'image/png',
      }),
    } as any;

    service = new TelehealthService(repo, livekit, storage);
  });

  it('upload ảnh PNG hợp lệ lên StorageService và lưu TelehealthMessage', async () => {
    const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    const file = {
      originalname: 'bp-monitor.png',
      mimetype: 'image/png',
      size: pngBuffer.length,
      buffer: pngBuffer,
    } as Express.Multer.File;

    repo.createMessage.mockResolvedValue({
      id: 'msg-img-1',
      sessionId: 'sess-1',
      attachmentKey: 'telehealth-attachments/enc-1/bp.png',
      attachmentName: 'bp-monitor.png',
      attachmentMimeType: 'image/png',
      attachmentSizeBytes: pngBuffer.length,
    } as any);

    const res = await service.uploadAttachment('enc-1', { id: 'fam-user-1', role: 'FAMILY_REP' }, file);
    expect(storage.uploadFile).toHaveBeenCalled();
    expect(res.attachmentName).toBe('bp-monitor.png');
  });

  it('từ chối 400 nếu tệp giả mạo magic bytes', async () => {
    const fakeFile = {
      originalname: 'fake.png',
      mimetype: 'image/png',
      size: 16,
      buffer: Buffer.from('not-a-real-png-file'),
    } as Express.Multer.File;

    await expect(
      service.uploadAttachment('enc-1', { id: 'fam-user-1', role: 'FAMILY_REP' }, fakeFile),
    ).rejects.toThrow(BadRequestException);
  });

  it('từ chối 403 nếu người ngoài phiên tải tệp đính kèm', async () => {
    await expect(
      service.downloadAttachment('enc-1', 'msg-img-1', { id: 'outsider', role: 'DOCTOR' }),
    ).rejects.toThrow(ForbiddenException);
  });
});
