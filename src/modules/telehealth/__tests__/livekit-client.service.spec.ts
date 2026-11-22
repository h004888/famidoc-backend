import { ServiceUnavailableException } from '@nestjs/common';
import { LivekitClientService } from '../services/livekit-client.service';

describe('LivekitClientService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('cấp JWT chứa đúng room, identity và metadata khi cấu hình đầy đủ', async () => {
    process.env.LIVEKIT_URL = 'https://rtc.famidoc.online';
    process.env.LIVEKIT_PUBLIC_URL = 'wss://rtc.famidoc.online';
    process.env.LIVEKIT_API_KEY = 'lk_test_key';
    process.env.LIVEKIT_API_SECRET = 'lk_test_secret_at_least_32_characters_long';

    const service = new LivekitClientService();
    const jwt = await service.createParticipantToken({
      roomName: 'telehealth-enc-1',
      identity: 'DOCTOR:user-1',
      name: 'BS. Nguyễn Văn A',
      metadata: { role: 'DOCTOR', userId: 'user-1' },
    });

    expect(typeof jwt).toBe('string');
    const [, payloadB64] = jwt.split('.');
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    expect(payload.sub).toBe('DOCTOR:user-1');
    expect(payload.name).toBe('BS. Nguyễn Văn A');
    expect(payload.video?.room).toBe('telehealth-enc-1');
    expect(payload.video?.roomJoin).toBe(true);
    expect(JSON.parse(payload.metadata)).toEqual({ role: 'DOCTOR', userId: 'user-1' });
    expect(service.getPublicUrl()).toBe('wss://rtc.famidoc.online');
  });

  it('từ chối cấp token khi thiếu cấu hình LIVEKIT_*', async () => {
    process.env.LIVEKIT_URL = 'https://rtc.famidoc.online';
    delete process.env.LIVEKIT_PUBLIC_URL;
    delete process.env.LIVEKIT_API_KEY;
    delete process.env.LIVEKIT_API_SECRET;

    const service = new LivekitClientService();
    await expect(
      service.createParticipantToken({
        roomName: 'telehealth-enc-1',
        identity: 'FAMILY_REP:user-2',
        name: 'Gia đình',
        metadata: { role: 'FAMILY_REP', userId: 'user-2' },
      }),
    ).rejects.toThrow(ServiceUnavailableException);
  });
});
