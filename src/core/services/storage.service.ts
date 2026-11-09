import { Injectable, Logger } from '@nestjs/common';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { extname } from 'path';

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

  /**
   * Upload file gốc lên SeaweedFS S3
   * @param file File nhận từ NestJS Multer Interceptor
   * @param folder Thư mục lưu trữ logic (vd: 'avatars', 'documents')
   * @returns Key tương đối lưu vào Database (vd: "avatars/1730000000000-123.jpg")
   */
  async uploadFile(file: Express.Multer.File, folder = 'avatars'): Promise<string> {
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
}

