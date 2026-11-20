import { buildMediaUrl } from '../utils/media-url.util';

describe('MediaUrlUtil', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      MEDIA_BASE_URL: 'https://media.famidoc.online',
      IMGPROXY_KEY: '8b2a686c2e84ef19760c5262f4df645730bc340da3004ce5cb887d88fa2f06b0',
      IMGPROXY_SALT: '70f30ffee1a6c378a8977eb2f141757590d59f512c90d7f6f903054e1b8c35fc',
      S3_BUCKET: 'photos',
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('nên trả về rỗng nếu s3Key rỗng', () => {
    expect(buildMediaUrl('')).toBe('');
  });

  it('nên giữ nguyên nếu s3Key đã là link http/https tuyệt đối', () => {
    const externalUrl = 'https://example.com/avatar.jpg';
    expect(buildMediaUrl(externalUrl)).toBe(externalUrl);
  });

  it('nên sinh URL hợp lệ có chữ ký HMAC SHA-256 cho s3Key tương đối', () => {
    const key = 'avatars/user-1.jpg';
    const result = buildMediaUrl(key, { width: 300, height: 200, format: 'webp' });

    expect(result).toMatch(/^https:\/\/media\.famidoc\.online\/[a-zA-Z0-9_-]+\/resize:fill:300:200:0\/gravity:sm\/plain\/s3:\/\/photos\/avatars\/user-1\.jpg@webp$/);
  });

  it('nên hỗ trợ s3Key đã có tiền tố s3://', () => {
    const s3Uri = 's3://photos/records/report.png';
    const result = buildMediaUrl(s3Uri, { width: 500, height: 500, format: 'png' });

    expect(result).toContain('/plain/s3://photos/records/report.png@png');
  });
});

