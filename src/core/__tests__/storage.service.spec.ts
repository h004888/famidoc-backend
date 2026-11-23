import { Readable } from 'stream';
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
    GetObjectCommand: jest.fn().mockImplementation((args) => args),
    PutObjectCommand: jest.fn().mockImplementation((args) => args),
    HeadObjectCommand: jest.fn().mockImplementation((args) => args),
    DeleteObjectCommand: jest.fn().mockImplementation((args) => args),
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

  it('xóa tệp theo key và không ném lỗi khi tệp không tồn tại hoặc S3 tạm lỗi', async () => {
    await expect(
      service.deleteFile('patient-documents/p-1/doc.pdf'),
    ).resolves.toBeUndefined();
    expect(mockSend).toHaveBeenCalledWith(
      { Bucket: 'photos', Key: 'patient-documents/p-1/doc.pdf' },
      expect.any(Object),
    );

    mockSend.mockRejectedValueOnce(
      new S3ServiceException({
        name: 'NotFound',
        $fault: 'client',
        $metadata: { httpStatusCode: 404 },
      }),
    );
    await expect(service.deleteFile('missing.pdf')).resolves.toBeUndefined();

    mockSend.mockRejectedValueOnce(new Error('Network error'));
    await expect(service.deleteFile('broken.pdf')).resolves.toBeUndefined();
  });

  describe('downloadFileStream', () => {
    it('trả về stream Readable kèm contentType và contentLength khi S3 phản hồi thành công', async () => {
      const mockStream = Readable.from([Buffer.from('%PDF-1.7-stream')]);
      mockSend.mockResolvedValueOnce({
        Body: mockStream,
        ContentType: 'application/pdf',
        ContentLength: 15,
      });

      const result = await service.downloadFileStream(
        'patient-documents/p-1/test.pdf',
      );

      expect(result.contentType).toBe('application/pdf');
      expect(result.contentLength).toBe(15);
      expect(result.stream).toBe(mockStream);
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('tự động thử lại 1 lần khi gặp lỗi kết nối nhàn rỗi và thành công ở lần 2', async () => {
      const mockStream = Readable.from([Buffer.from('image-bytes')]);
      mockSend
        .mockRejectedValueOnce(new Error('ECONNRESET'))
        .mockResolvedValueOnce({
          Body: mockStream,
          ContentType: 'image/jpeg',
          ContentLength: 11,
        });

      const result = await service.downloadFileStream(
        'patient-documents/p-1/photo.jpg',
      );

      expect(result.contentType).toBe('image/jpeg');
      expect(result.stream).toBe(mockStream);
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('không retry và ném 404 NotFoundException khi khóa tệp không còn trên S3', async () => {
      mockSend.mockRejectedValueOnce(
        new S3ServiceException({
          name: 'NoSuchKey',
          $fault: 'client',
          $metadata: { httpStatusCode: 404 },
        }),
      );

      await expect(
        service.downloadFileStream('patient-documents/p-1/missing.pdf'),
      ).rejects.toMatchObject({ status: 404 });
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('ném 503 ServiceUnavailableException khi cả 2 lần thử đều lỗi mạng', async () => {
      mockSend
        .mockRejectedValueOnce(new Error('Timeout 1'))
        .mockRejectedValueOnce(new Error('Timeout 2'));

      await expect(
        service.downloadFileStream('patient-documents/p-1/stuck.pdf'),
      ).rejects.toMatchObject({ status: 503 });
      expect(mockSend).toHaveBeenCalledTimes(2);
    });
  });
});
