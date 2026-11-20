import { BadRequestException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import {
  MAX_BULK_IMPORT_FILE_BYTES,
  MAX_BULK_IMPORT_READ_ROWS,
  type BulkDoctorInvalidRowDto,
  type BulkDoctorNormalizedRowDto,
} from '../dtos/bulk-import-doctors.dto';
import {
  normalizeVietnameseMobilePhone,
  VN_MOBILE_PHONE_REGEX,
} from './vietnamese-phone.util';

export { normalizeVietnameseMobilePhone };

export const DEFAULT_DOCTOR_SPECIALTY = 'Y học gia đình';

export const SUGGESTED_SPECIALTIES = [
  'Khoa Y học Gia đình',
  'Khoa Nội Tổng quát',
  'Khoa Nhi',
  'Khoa Cấp cứu & Y tế Gia đình',
  'Khoa Nội tiết',
] as const;

export const SUGGESTED_ACADEMIC_TITLES = [
  'BS',
  'ThS.BS',
  'BS.CKI',
  'BS.CKII',
  'TS.BS',
  'PGS.TS.BS',
] as const;

export type ParsedExcelRowResult =
  | {
      isValid: true;
      row: BulkDoctorNormalizedRowDto;
    }
  | {
      isValid: false;
      invalidRow: BulkDoctorInvalidRowDto;
    };

export interface ParsedDoctorsExcelResult {
  totalReadRows: number;
  rows: ParsedExcelRowResult[];
}

type MappedColumnField =
  | 'doctorName'
  | 'email'
  | 'phone'
  | 'specialty'
  | 'academicTitle'
  | 'experienceYears'
  | 'bio';

const HEADER_ALIASES: Record<string, MappedColumnField> = {
  'ho va ten': 'doctorName',
  'ho ten': 'doctorName',
  'ten bac si': 'doctorName',
  doctorname: 'doctorName',
  fullname: 'doctorName',
  email: 'email',
  'email dang nhap': 'email',
  'so dien thoai': 'phone',
  sdt: 'phone',
  'dien thoai': 'phone',
  phone: 'phone',
  'chuyen khoa': 'specialty',
  'khoa phong': 'specialty',
  'khoa phong chuyen mon': 'specialty',
  specialty: 'specialty',
  'hoc ham hoc vi': 'academicTitle',
  'hoc ham / hoc vi': 'academicTitle',
  'hoc vi / hoc ham': 'academicTitle',
  'hoc vi': 'academicTitle',
  'hoc ham': 'academicTitle',
  academictitle: 'academicTitle',
  'so nam kinh nghiem': 'experienceYears',
  'kinh nghiem': 'experienceYears',
  'nam kinh nghiem': 'experienceYears',
  experienceyears: 'experienceYears',
  'tieu su chuyen mon': 'bio',
  'tieu su': 'bio',
  bio: 'bio',
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeHeaderKey(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/\(\*\)/g, '')
    .replace(/[^a-zA-Z0-9/\s]/g, ' ')
    .replace(/\s*\/\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function extractExcelCellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value).trim();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'object') {
    if ('text' in value && typeof value.text === 'string') {
      return value.text.trim();
    }
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText
        .map((part) => part?.text ?? '')
        .join('')
        .trim();
    }
    if ('result' in value && value.result !== undefined && value.result !== null) {
      if (typeof value.result === 'object' && 'error' in value.result) {
        return '';
      }
      return String(value.result).trim();
    }
    if ('hyperlink' in value && typeof value.hyperlink === 'string') {
      return value.hyperlink.replace(/^mailto:/i, '').trim();
    }
  }
  return String(value).trim();
}

export function normalizeEmailValue(raw: string): string {
  return raw.trim().toLowerCase();
}

export async function buildDoctorImportTemplateWorkbookBuffer(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'FamiDoc';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Danh sách bác sĩ', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  sheet.columns = [
    { header: 'Họ và tên (*)', key: 'doctorName', width: 28 },
    { header: 'Email (*)', key: 'email', width: 30 },
    {
      header: 'Số điện thoại (*)',
      key: 'phone',
      width: 20,
      style: { numFmt: '@' },
    },
    { header: 'Chuyên khoa', key: 'specialty', width: 28 },
    { header: 'Học hàm / Học vị', key: 'academicTitle', width: 20 },
    { header: 'Số năm kinh nghiệm', key: 'experienceYears', width: 20 },
    { header: 'Tiểu sử chuyên môn', key: 'bio', width: 42 },
  ];

  const headerRow = sheet.getRow(1);
  headerRow.height = 26;
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0037C1' },
    };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    };
  });

  const specialtyFormula = `"${SUGGESTED_SPECIALTIES.join(',')}"`;
  const academicFormula = `"${SUGGESTED_ACADEMIC_TITLES.join(',')}"`;

  for (let rowIdx = 2; rowIdx <= MAX_BULK_IMPORT_READ_ROWS + 1; rowIdx += 1) {
    const phoneCell = sheet.getCell(rowIdx, 3);
    phoneCell.numFmt = '@';

    const specialtyCell = sheet.getCell(rowIdx, 4);
    specialtyCell.dataValidation = {
      type: 'list',
      allowBlank: true,
      showErrorMessage: false,
      formulae: [specialtyFormula],
    };

    const academicCell = sheet.getCell(rowIdx, 5);
    academicCell.dataValidation = {
      type: 'list',
      allowBlank: true,
      showErrorMessage: false,
      formulae: [academicFormula],
    };
  }

  const guideSheet = workbook.addWorksheet('Hướng dẫn');
  guideSheet.columns = [
    { header: 'Mục', key: 'topic', width: 28 },
    { header: 'Quy định & Ví dụ', key: 'detail', width: 80 },
  ];

  const guideHeader = guideSheet.getRow(1);
  guideHeader.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0F3A5D' },
    };
  });

  const guideRows = [
    [
      'Các cột bắt buộc (*)',
      'Họ và tên (*), Email (*), Số điện thoại (*) không được để trống.',
    ],
    [
      'Giới hạn tệp & lượt tạo',
      'Định dạng .xlsx, dung lượng <= 2MB, đọc tối đa 100 dòng dữ liệu mỗi tệp; mỗi lượt xác nhận khởi tạo tối đa 30 bác sĩ mới.',
    ],
    [
      'Tái sử dụng file cũ',
      'Nếu bạn giữ nguyên bác sĩ đã tạo ở lần trước trong file này (trùng cả Email và Số điện thoại tại chính CSYT), hệ thống sẽ tự động bỏ qua an toàn.',
    ],
    [
      'Số điện thoại',
      'Định dạng di động Việt Nam (10 số bắt đầu 03, 05, 07, 08, 09). Cột đã cài sẵn định dạng Text để không bị mất số 0 đầu.',
    ],
    [
      'Chuyên khoa & Học vị',
      'Có danh sách gợi ý sẵn; bạn vẫn có thể nhập chuyên khoa hoặc học vị khác phù hợp. Nếu để trống Chuyên khoa, mặc định là "Y học gia đình".',
    ],
    [
      'Số năm kinh nghiệm',
      'Số nguyên từ 0 đến 60. Nếu để trống, mặc định là 0.',
    ],
    [
      'Ví dụ 1 dòng hợp lệ',
      'BS. CKI Nguyễn Văn An | bs.an@benhvien.vn | 0912345678 | Khoa Y học Gia đình | BS.CKI | 8 | 8 năm kinh nghiệm khám gia đình',
    ],
  ];

  guideRows.forEach((row) => guideSheet.addRow(row));

  const output = await workbook.xlsx.writeBuffer();
  return Buffer.isBuffer(output) ? output : Buffer.from(output);
}

function validateZipSignature(buffer: Buffer): boolean {
  return (
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07)
  );
}

export async function parseDoctorsExcelBuffer(
  buffer: Buffer,
  originalName?: string,
): Promise<ParsedDoctorsExcelResult> {
  if (!buffer || buffer.length === 0) {
    throw new BadRequestException('Vui lòng chọn file Excel (.xlsx) hợp lệ để kiểm tra');
  }
  if (buffer.length > MAX_BULK_IMPORT_FILE_BYTES) {
    throw new BadRequestException(
      'Dung lượng file Excel vượt quá giới hạn tối đa 2MB',
    );
  }
  if (
    originalName &&
    !/\.xlsx$/i.test(originalName.trim())
  ) {
    throw new BadRequestException(
      'Chỉ hỗ trợ định dạng file Excel (.xlsx). Vui lòng tải file mẫu chuẩn và lưu dưới dạng .xlsx',
    );
  }
  if (!validateZipSignature(buffer)) {
    throw new BadRequestException(
      'File tải lên không đúng định dạng .xlsx hợp lệ',
    );
  }

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new BadRequestException(
      'Không thể đọc nội dung file Excel (.xlsx). File có thể bị hỏng hoặc sai định dạng',
    );
  }

  const worksheet = workbook.worksheets[0];
  if (!worksheet || worksheet.rowCount < 1) {
    throw new BadRequestException('File Excel không có dữ liệu');
  }

  const headerRow = worksheet.getRow(1);
  const columnMap = new Map<number, MappedColumnField>();
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const text = extractExcelCellText(cell.value);
    const normalized = normalizeHeaderKey(text);
    const mappedField = HEADER_ALIASES[normalized];
    if (mappedField && !Array.from(columnMap.values()).includes(mappedField)) {
      columnMap.set(colNumber, mappedField);
    }
  });

  const mappedFields = new Set(columnMap.values());
  const missingHeaders: string[] = [];
  if (!mappedFields.has('doctorName')) missingHeaders.push('Họ và tên');
  if (!mappedFields.has('email')) missingHeaders.push('Email');
  if (!mappedFields.has('phone')) missingHeaders.push('Số điện thoại');

  if (missingHeaders.length > 0) {
    throw new BadRequestException(
      `File Excel thiếu cột bắt buộc ở dòng tiêu đề: ${missingHeaders.join(', ')}. Vui lòng dùng đúng file mẫu của hệ thống`,
    );
  }

  const parsedRows: ParsedExcelRowResult[] = [];
  let nonEmptyCount = 0;

  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const rawValues: Record<MappedColumnField, string> = {
      doctorName: '',
      email: '',
      phone: '',
      specialty: '',
      academicTitle: '',
      experienceYears: '',
      bio: '',
    };

    for (const [colNumber, field] of columnMap.entries()) {
      rawValues[field] = extractExcelCellText(row.getCell(colNumber).value);
    }

    const isBlankRow = Object.values(rawValues).every((v) => v === '');
    if (isBlankRow) continue;

    nonEmptyCount += 1;
    if (nonEmptyCount > MAX_BULK_IMPORT_READ_ROWS) {
      throw new BadRequestException(
        `Mỗi lần chỉ hỗ trợ đọc tối đa ${MAX_BULK_IMPORT_READ_ROWS} dòng dữ liệu. Vui lòng tách nhỏ danh sách để kiểm tra`,
      );
    }

    const errors: string[] = [];
    const doctorName = rawValues.doctorName.trim();
    const email = normalizeEmailValue(rawValues.email);
    const phone = normalizeVietnameseMobilePhone(rawValues.phone);
    const specialty = rawValues.specialty.trim() || DEFAULT_DOCTOR_SPECIALTY;
    const academicTitle = rawValues.academicTitle.trim() || undefined;
    const bio = rawValues.bio.trim() || undefined;

    if (!doctorName) {
      errors.push('Thiếu họ và tên bác sĩ');
    } else if (doctorName.length < 2 || doctorName.length > 100) {
      errors.push('Họ và tên bác sĩ phải từ 2 đến 100 ký tự');
    }

    if (!email) {
      errors.push('Thiếu email');
    } else if (!EMAIL_REGEX.test(email) || email.length > 150) {
      errors.push('Email không đúng định dạng hợp lệ');
    }

    if (!phone) {
      errors.push('Thiếu số điện thoại');
    } else if (!VN_MOBILE_PHONE_REGEX.test(phone)) {
      errors.push('Số điện thoại không đúng định dạng di động Việt Nam');
    }

    if (specialty.length > 100) {
      errors.push('Chuyên khoa tối đa 100 ký tự');
    }

    if (academicTitle && academicTitle.length > 50) {
      errors.push('Học hàm / học vị tối đa 50 ký tự');
    }

    if (bio && bio.length > 2000) {
      errors.push('Tiểu sử chuyên môn tối đa 2000 ký tự');
    }

    let experienceYears = 0;
    if (rawValues.experienceYears !== '') {
      if (!/^-?\d+$/.test(rawValues.experienceYears)) {
        errors.push('Số năm kinh nghiệm phải là số nguyên');
      } else {
        const parsedExp = Number(rawValues.experienceYears);
        if (!Number.isInteger(parsedExp) || parsedExp < 0 || parsedExp > 60) {
          errors.push('Số năm kinh nghiệm phải từ 0 đến 60');
        } else {
          experienceYears = parsedExp;
        }
      }
    }

    if (errors.length > 0) {
      parsedRows.push({
        isValid: false,
        invalidRow: {
          rowNumber,
          raw: {
            doctorName: rawValues.doctorName || undefined,
            email: rawValues.email || undefined,
            phone: rawValues.phone || undefined,
            specialty: rawValues.specialty || undefined,
            academicTitle: rawValues.academicTitle || undefined,
            experienceYears: rawValues.experienceYears || undefined,
            bio: rawValues.bio || undefined,
          },
          errors,
        },
      });
    } else {
      parsedRows.push({
        isValid: true,
        row: {
          rowNumber,
          doctorName,
          email,
          phone,
          specialty,
          ...(academicTitle ? { academicTitle } : {}),
          experienceYears,
          ...(bio ? { bio } : {}),
        },
      });
    }
  }

  if (nonEmptyCount === 0) {
    throw new BadRequestException(
      'File Excel chưa có dòng dữ liệu bác sĩ nào. Vui lòng nhập ít nhất 1 dòng',
    );
  }

  return {
    totalReadRows: nonEmptyCount,
    rows: parsedRows,
  };
}
