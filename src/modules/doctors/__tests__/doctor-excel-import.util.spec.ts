import { BadRequestException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import {
  buildDoctorImportTemplateWorkbookBuffer,
  normalizeVietnameseMobilePhone,
  parseDoctorsExcelBuffer,
} from '../utils/doctor-excel-import.util';
import {
  MAX_BULK_IMPORT_FILE_BYTES,
  MAX_BULK_IMPORT_READ_ROWS,
} from '../dtos/bulk-import-doctors.dto';

async function createWorkbookBuffer(
  rows: Array<Array<string | number | undefined>>,
  headers: string[] = [
    'Họ và tên (*)',
    'Email (*)',
    'Số điện thoại (*)',
    'Chuyên khoa',
    'Học hàm / Học vị',
    'Số năm kinh nghiệm',
    'Tiểu sử chuyên môn',
  ],
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Danh sách bác sĩ');
  ws.addRow(headers);
  for (const r of rows) {
    ws.addRow(r);
  }
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
}

describe('doctor-excel-import.util', () => {
  it('tạo file mẫu .xlsx có 2 sheet, cột SĐT Text và dropdown gợi ý', async () => {
    const buffer = await buildDoctorImportTemplateWorkbookBuffer();
    expect(buffer[0]).toBe(0x50);
    expect(buffer[1]).toBe(0x4b);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);

    expect(wb.worksheets.map((s) => s.name)).toEqual([
      'Danh sách bác sĩ',
      'Hướng dẫn',
    ]);
    const mainSheet = wb.worksheets[0];
    expect(mainSheet.getCell('C2').numFmt).toBe('@');
    expect(mainSheet.getCell('D2').dataValidation?.type).toBe('list');
    expect(mainSheet.getCell('E2').dataValidation?.type).toBe('list');
  });

  it('chuẩn hóa SĐT mất số 0 đầu hoặc có +84/84 và khoảng trắng', () => {
    expect(normalizeVietnameseMobilePhone('912345678')).toBe('0912345678');
    expect(normalizeVietnameseMobilePhone('+84 912.345-678')).toBe('0912345678');
    expect(normalizeVietnameseMobilePhone('84987654321')).toBe('0987654321');
    expect(normalizeVietnameseMobilePhone('0345678901')).toBe('0345678901');
  });

  it('đọc file hợp lệ, chấp nhận chuyên khoa/học vị tùy chỉnh và mặc định khi bỏ trống', async () => {
    const buffer = await createWorkbookBuffer([
      [
        'BS. Nguyễn Văn An',
        '  BS.An@Hospital.VN ',
        912345678,
        'Chuyên khoa Tim mạch lão khoa',
        'TS.BS Nội trú',
        5,
        'Kinh nghiệm khám tại nhà',
      ],
      ['BS. Trần Thị Bình', 'binh@hospital.vn', '0987654321', '', '', '', ''],
    ]);

    const parsed = await parseDoctorsExcelBuffer(buffer, 'doctors.xlsx');
    expect(parsed.totalReadRows).toBe(2);
    expect(parsed.rows[0]).toEqual({
      isValid: true,
      row: {
        rowNumber: 2,
        doctorName: 'BS. Nguyễn Văn An',
        email: 'bs.an@hospital.vn',
        phone: '0912345678',
        specialty: 'Chuyên khoa Tim mạch lão khoa',
        academicTitle: 'TS.BS Nội trú',
        experienceYears: 5,
        bio: 'Kinh nghiệm khám tại nhà',
      },
    });
    expect(parsed.rows[1]).toEqual({
      isValid: true,
      row: {
        rowNumber: 3,
        doctorName: 'BS. Trần Thị Bình',
        email: 'binh@hospital.vn',
        phone: '0987654321',
        specialty: 'Y học gia đình',
        experienceYears: 0,
      },
    });
  });

  it('báo lỗi từng dòng khi thiếu cột bắt buộc, sai email/SĐT hoặc kinh nghiệm âm', async () => {
    const buffer = await createWorkbookBuffer([
      ['A', 'khong-phai-email', '12345', '', '', -2, ''],
    ]);

    const parsed = await parseDoctorsExcelBuffer(buffer, 'invalid.xlsx');
    expect(parsed.totalReadRows).toBe(1);
    expect(parsed.rows[0].isValid).toBe(false);
    if (!parsed.rows[0].isValid) {
      expect(parsed.rows[0].invalidRow.errors).toEqual(
        expect.arrayContaining([
          expect.stringContaining('2 đến 100 ký tự'),
          expect.stringContaining('Email không đúng định dạng'),
          expect.stringContaining('Số điện thoại không đúng định dạng'),
          expect.stringContaining('Số năm kinh nghiệm phải từ 0 đến 60'),
        ]),
      );
    }
  });

  it('từ chối file vượt dung lượng 2MB, sai định dạng hoặc vượt quá 100 dòng', async () => {
    await expect(
      parseDoctorsExcelBuffer(Buffer.alloc(MAX_BULK_IMPORT_FILE_BYTES + 1), 'big.xlsx'),
    ).rejects.toThrow(BadRequestException);

    await expect(
      parseDoctorsExcelBuffer(Buffer.from('not-a-zip-file'), 'fake.xlsx'),
    ).rejects.toThrow(BadRequestException);

    const validBuf = await createWorkbookBuffer([
      ['BS Test', 'test@hospital.vn', '0912345678'],
    ]);
    await expect(
      parseDoctorsExcelBuffer(validBuf, 'doctors.csv'),
    ).rejects.toThrow(BadRequestException);

    const tooManyRows = Array.from(
      { length: MAX_BULK_IMPORT_READ_ROWS + 1 },
      (_, idx) => [`BS ${idx + 1}`, `bs${idx + 1}@hospital.vn`, `0912345${String(idx).padStart(3, '0')}`],
    );
    const overLimitBuf = await createWorkbookBuffer(tooManyRows);
    await expect(
      parseDoctorsExcelBuffer(overLimitBuf, 'over100.xlsx'),
    ).rejects.toThrow(BadRequestException);
  });

  it('từ chối file thiếu cột tiêu đề bắt buộc hoặc không có dòng dữ liệu', async () => {
    const missingHeaderBuf = await createWorkbookBuffer(
      [['BS An', 'an@hospital.vn']],
      ['Họ và tên', 'Email'],
    );
    await expect(
      parseDoctorsExcelBuffer(missingHeaderBuf, 'missing-header.xlsx'),
    ).rejects.toThrow(BadRequestException);

    const emptyDataBuf = await createWorkbookBuffer([]);
    await expect(
      parseDoctorsExcelBuffer(emptyDataBuf, 'empty.xlsx'),
    ).rejects.toThrow(BadRequestException);
  });
});
