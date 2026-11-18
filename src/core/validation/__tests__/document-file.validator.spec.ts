import { BadRequestException } from '@nestjs/common';
import { validateUploadedDocumentFile } from '../document-file.validator';

describe('validateUploadedDocumentFile', () => {
  it('accepts valid PDF magic bytes even with arbitrary filename', () => {
    const pdfBuf = Buffer.from('%PDF-1.7\n...');
    const result = validateUploadedDocumentFile({
      buffer: pdfBuf,
      size: pdfBuf.length,
      originalname: 'cchn.pdf',
    });
    expect(result).toEqual({
      contentType: 'application/pdf',
      extension: 'pdf',
      buffer: pdfBuf,
    });
  });

  it('accepts valid PNG and JPEG magic bytes', () => {
    const pngBuf = Buffer.concat([
      Buffer.from('89504e470d0a1a0a', 'hex'),
      Buffer.from([0x00, 0x01]),
    ]);
    expect(
      validateUploadedDocumentFile({
        buffer: pngBuf,
        size: pngBuf.length,
        originalname: 'scan.png',
      }),
    ).toMatchObject({ contentType: 'image/png', extension: 'png' });

    const jpgBuf = Buffer.concat([
      Buffer.from('ffd8ff', 'hex'),
      Buffer.from([0xe0, 0x00, 0x10]),
    ]);
    expect(
      validateUploadedDocumentFile({
        buffer: jpgBuf,
        size: jpgBuf.length,
        originalname: 'scan.jpg',
      }),
    ).toMatchObject({ contentType: 'image/jpeg', extension: 'jpg' });
  });

  it('rejects spoofed .pdf extension with invalid bytes', () => {
    const fakePdf = Buffer.from('<html>not a pdf</html>');
    expect(() =>
      validateUploadedDocumentFile({
        buffer: fakePdf,
        size: fakePdf.length,
        originalname: 'fake.pdf',
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects missing or empty file', () => {
    expect(() => validateUploadedDocumentFile(undefined)).toThrow(
      BadRequestException,
    );
    expect(() =>
      validateUploadedDocumentFile({
        buffer: Buffer.alloc(0),
        size: 0,
        originalname: 'empty.pdf',
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects oversized payload', () => {
    const buf = Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(1024)]);
    expect(() =>
      validateUploadedDocumentFile(
        {
          buffer: buf,
          size: buf.length,
          originalname: 'big.pdf',
        },
        { maxBytes: 100 },
      ),
    ).toThrow(BadRequestException);
  });
});
