import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { extname } from 'path';
import { Readable } from 'stream';
import type { ReadableStream as NodeWebReadableStream } from 'stream/web';

export interface DownloadedFileStream {
  stream: Readable;
  contentType: string;
  contentLength?: number;
}

const STREAM_REQUEST_TIMEOUT_MS = 15_000;
const STREAM_RETRY_DELAY_MS = 250;

function isS3NotFoundError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as {
    name?: string;
    $metadata?: { httpStatusCode?: number };
  };
  return (
    err.$metadata?.httpStatusCode === 404 ||
    err.name === 'NoSuchKey' ||
    err.name === 'NotFound'
  );
}

function toNodeReadable(body: unknown): Readable {
  if (body instanceof Readable) {
    return body;
  }
  if (
    body &&
    typeof (body as { pipe?: unknown }).pipe === 'function'
  ) {
    return body as Readable;
  }
  if (
    body &&
    typeof (body as { transformToWebStream?: unknown }).transformToWebStream ===
      'function'
  ) {
    const webStream = (
      body as { transformToWebStream: () => NodeWebReadableStream<Uint8Array> }
    ).transformToWebStream();
    return Readable.fromWeb(webStream);
  }
  throw new Error('Unsupported storage stream body');
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor() {
    this.bucket = process.env.S3_BUCKET || 'photos';
    this.s3 = new S3Client({
      endpoint: process.env.S3_ENDPOINT || 'https://s3.famidoc.online',
      region: process.env.S3_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY || '',
        secretAccessKey: process.env.S3_SECRET_KEY || '',
      },
      forcePathStyle: true,
    });
  }

  async objectExists(key: string): Promise<boolean> {
    try {
      // Chỉ hỏi metadata để biết tệp tồn tại, không tải nội dung chứng từ xuống.
      await this.s3.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
        { abortSignal: AbortSignal.timeout(2_500) },
      );
      return true;
    } catch (error) {
      if (
        error instanceof S3ServiceException &&
        error.$metadata.httpStatusCode === 404
      )
        return false;
      // Lỗi mạng hoặc quyền truy cập S3 cần báo riêng để người dùng có thể thử lại.
      throw new ServiceUnavailableException(
        'Không thể kiểm tra tệp trên kho lưu trữ.',
      );
    }
  }

  async downloadFile(key: string): Promise<{ bytes: Buffer; contentType: string }> {
    try {
      const response = await this.s3.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
        { abortSignal: AbortSignal.timeout(30_000) },
      );
      if (!response.Body) throw new Error('Empty storage response');
      return {
        bytes: Buffer.from(await response.Body.transformToByteArray()),
        contentType: response.ContentType ?? 'application/octet-stream',
      };
    } catch {
      throw new ServiceUnavailableException('Không thể tải tệp từ kho lưu trữ.');
    }
  }

  /**
   * Mở luồng đọc trực tiếp tệp từ SeaweedFS S3, có retry ngắn khi kết nối nhàn rỗi bị gián đoạn
   * và phân biệt rõ lỗi 404 (tệp không tồn tại) với 503 (lỗi kho lưu trữ).
   */
  async downloadFileStream(key: string): Promise<DownloadedFileStream> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await this.s3.send(
          new GetObjectCommand({ Bucket: this.bucket, Key: key }),
          { abortSignal: AbortSignal.timeout(STREAM_REQUEST_TIMEOUT_MS) },
        );
        if (!response.Body) {
          throw new Error('Empty storage response');
        }
        return {
          stream: toNodeReadable(response.Body),
          contentType: response.ContentType ?? 'application/octet-stream',
          contentLength:
            typeof response.ContentLength === 'number'
              ? response.ContentLength
              : undefined,
        };
      } catch (error) {
        if (isS3NotFoundError(error)) {
          throw new NotFoundException(
            'Không tìm thấy tệp tài liệu trên kho lưu trữ.',
          );
        }
        this.logger.warn(
          `Lỗi đọc luồng tệp S3 (${key}, lần thử ${attempt + 1}/2): ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        if (attempt === 0) {
          await new Promise((resolve) =>
            setTimeout(resolve, STREAM_RETRY_DELAY_MS),
          );
        }
      }
    }

    throw new ServiceUnavailableException('Không thể tải tệp từ kho lưu trữ.');
  }

  /**
   * Upload file gốc lên SeaweedFS S3
   * @param file File nhận từ NestJS Multer Interceptor
   * @param folder Thư mục lưu trữ logic (vd: 'avatars', 'documents')
   * @returns Key tương đối lưu vào Database (vd: "avatars/1730000000000-123.jpg")
   */
  async uploadFile(
    file: Express.Multer.File,
    folder = 'avatars',
  ): Promise<string> {
    const fileExt = extname(file.originalname);
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const s3Key = `${folder}/${uniqueSuffix}${fileExt}`;

    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: s3Key,
        Body: file.buffer,
        ContentType: file.mimetype,
      }),
    );

    this.logger.log(`Tải file lên SeaweedFS S3 thành công: ${s3Key}`);
    return s3Key;
  }

  /**
   * Xóa tệp trên SeaweedFS S3; bỏ qua an toàn nếu tệp không còn tồn tại.
   */
  async deleteFile(key: string): Promise<void> {
    if (!key) return;
    try {
      await this.s3.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
        { abortSignal: AbortSignal.timeout(5_000) },
      );
    } catch (error) {
      if (
        error instanceof S3ServiceException &&
        error.$metadata?.httpStatusCode === 404
      ) {
        return;
      }
      this.logger.warn(
        `Không thể xóa tệp trên SeaweedFS S3 (${key}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
