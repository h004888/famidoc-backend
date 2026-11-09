import { StorageService } from '../services/storage.service';

jest.mock('@aws-sdk/client-s3', () => {
  const mSend = jest.fn().mockResolvedValue({ ETag: '"test-etag-12345"' });
  return {
    S3Client: jest.fn().mockImplementation(() => ({
      send: mSend,
    })),
    PutObjectCommand: jest.fn().mockImplementation((args) => args),
  };
});

describe('StorageService', () => {
  let service: StorageService;
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      S3_ENDPOINT: 'https://s3.famidoc.online',
      S3_BUCKET: 'photos',
      S3_ACCESS_KEY: 'AKIAFAMIDOCMEDIA2026',
      S3_SECRET_KEY: 'sec_famidoc_production_media_secret_key_98234',
      S3_REGION: 'us-east-1',
    };
    jest.clearAllMocks();
    service = new StorageService();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('nên khởi tạo dịch vụ thành công', () => {
    expect(service).toBeDefined();
  });

  it('nên upload file và trả về s3Key tương đối', async () => {
    const mockFile: Express.Multer.File = {
      fieldname: 'file',
      originalname: 'avatar-user.png',
      encoding: '7bit',
      mimetype: 'image/png',
      buffer: Buffer.from('fake-image-bytes'),
      size: 16,
      stream: null as any,
      destination: '',
      filename: '',
      path: '',
    };

    const s3Key = await service.uploadFile(mockFile, 'avatars');

    expect(s3Key).toMatch(/^avatars\/\d+-\d+\.png$/);
  });
});

