import * as crypto from 'crypto';

export interface ImageTransformOptions {
  width?: number;
  height?: number;
  resizingType?: 'fit' | 'fill' | 'auto';
  gravity?: 'no' | 'ce' | 'sm';
  format?: 'webp' | 'avif' | 'png' | 'jpg';
}

/**
 * Sinh link xem ảnh qua imgproxy + Nginx cache với chữ ký HMAC SHA-256 an toàn
 * @param s3Key Đường dẫn key trong bucket (vd: "avatars/user-1.jpg" hoặc "s3://photos/avatars/user-1.jpg")
 * @param options Các tùy chọn kích thước, crop và định dạng
 */
export function buildMediaUrl(s3Key: string, options: ImageTransformOptions = {}): string {
  if (!s3Key) return '';
  if (s3Key.startsWith('http://') || s3Key.startsWith('https://')) return s3Key;

  const baseUrl = process.env.MEDIA_BASE_URL || '';
  const keyHex = process.env.IMGPROXY_KEY || '';
  const saltHex = process.env.IMGPROXY_SALT || '';
  const bucket = process.env.S3_BUCKET || 'photos';

  const {
    width = 0,
    height = 0,
    resizingType = 'fill',
    gravity = 'sm',
    format = 'webp',
  } = options;

  const s3Path = s3Key.startsWith('s3://')
    ? s3Key
    : `s3://${bucket}/${s3Key.replace(/^\/+/, '')}`;

  const processingPath = `/resize:${resizingType}:${width}:${height}:0/gravity:${gravity}/plain/${s3Path}@${format}`;

  const hmac = crypto.createHmac('sha256', Buffer.from(keyHex, 'hex'));
  hmac.update(Buffer.from(saltHex, 'hex'));
  hmac.update(processingPath);
  const signature = hmac.digest('base64url');

  return `${baseUrl}/${signature}${processingPath}`;
}

