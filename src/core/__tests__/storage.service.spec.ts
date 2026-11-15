import { StorageService } from '../services/storage.service';
import { S3ServiceException } from '@aws-sdk/client-s3';

const mockSend = jest.fn();
jest.mock('@aws-sdk/client-s3', () => {
  return {
    S3ServiceException:
      jest.requireActual<typeof import('@aws-sdk/client-s3')>(
        '@aws-sdk/client-s3',
      ).S3ServiceException,
    S3Client: jest.fn().mockImplementation(() => ({
      send: mockSend,
    })),
    PutObjectCommand: jest.fn().mockImplementation((args) => args),
    HeadObjectCommand: jest.fn().mockImplementation((args) => args),
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
    mockSend.mockReset().mockResolvedValue({ ETag: '"test-etag-12345"' });
    service = new StorageService();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('nên khởi tạo dịch vụ thành công', () => {
    expect(service).toBeDefined();
  });

  it('kiểm tra metadata đúng bucket và khóa tệp', async () => {
    const key = 'demo/settlements/proof.pdf';
    await expect(service.objectExists(key)).resolves.toBe(true);
    expect(mockSend).toHaveBeenCalledWith(
      { Bucket: 'photos', Key: key },
      expect.any(Object),
    );
  });

  it('phân biệt tệp không tồn tại với lỗi truy cập S3', async () => {
    mockSend.mockRejectedValueOnce(
      new S3ServiceException({
        name: 'NotFound',
        $fault: 'client',
        $metadata: { httpStatusCode: 404 },
      }),
    );
    await expect(service.objectExists('missing.pdf')).resolves.toBe(false);
    mockSend.mockRejectedValueOnce(new Error('Storage unavailable'));
    await expect(service.objectExists('proof.pdf')).rejects.toMatchObject({
      status: 503,
    });
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
