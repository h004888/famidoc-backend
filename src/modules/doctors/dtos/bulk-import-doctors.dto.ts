import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import type { DoctorResponseDto } from './doctor-response.dto';
import {
  normalizeVietnameseMobilePhone,
  VN_MOBILE_PHONE_REGEX,
} from '../utils/vietnamese-phone.util';

export { VN_MOBILE_PHONE_REGEX };
export const MAX_BULK_IMPORT_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_BULK_IMPORT_READ_ROWS = 100;
export const MAX_BULK_IMPORT_CONFIRM_BATCH = 30;

export type DoctorBulkImportRowStatus =
  | 'NEW_VALID'
  | 'EXISTING_SKIPPED'
  | 'INVALID';

export interface BulkDoctorNormalizedRowDto {
  rowNumber: number;
  doctorName: string;
  email: string;
  phone: string;
  specialty: string;
  academicTitle?: string;
  experienceYears: number;
  bio?: string;
}

export interface BulkDoctorExistingRowDto {
  rowNumber: number;
  doctorName: string;
  email: string;
  phone: string;
  existingDoctorId: string;
  existingDoctorName: string;
  existingOnboardingStatus: string;
  reason: string;
}

export interface BulkDoctorInvalidRowDto {
  rowNumber: number;
  raw: {
    doctorName?: string;
    email?: string;
    phone?: string;
    specialty?: string;
    academicTitle?: string;
    experienceYears?: string | number;
    bio?: string;
  };
  errors: string[];
}

export interface BulkImportPreviewSummaryDto {
  totalReadRows: number;
  validCount: number;
  existingSkippedCount: number;
  invalidCount: number;
  maxReadRows: number;
  maxConfirmBatch: number;
}

export interface BulkImportDoctorsPreviewResponseDto {
  summary: BulkImportPreviewSummaryDto;
  validRows: BulkDoctorNormalizedRowDto[];
  existingRows: BulkDoctorExistingRowDto[];
  invalidRows: BulkDoctorInvalidRowDto[];
}

export class ConfirmBulkDoctorItemDto {
  @ApiPropertyOptional({
    description: 'Số thứ tự dòng trong file Excel gốc (dùng để đối chiếu báo cáo)',
    example: 2,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'rowNumber phải là số nguyên dương' })
  @Min(1, { message: 'rowNumber phải >= 1' })
  rowNumber?: number;

  @ApiProperty({
    description: 'Địa chỉ email đăng nhập của bác sĩ',
    example: 'bs.nguyenvanan@famidoc.vn',
  })
  @IsNotEmpty({ message: 'Email không được để trống' })
  @IsEmail({}, { message: 'Định dạng email không hợp lệ' })
  email!: string;

  @ApiProperty({
    description: 'Số điện thoại di động Việt Nam đã chuẩn hóa của bác sĩ',
    example: '0912345678',
  })
  @Transform(({ value }) =>
    typeof value === 'string' ? normalizeVietnameseMobilePhone(value) : value,
  )
  @IsNotEmpty({ message: 'Số điện thoại không được để trống' })
  @Matches(VN_MOBILE_PHONE_REGEX, {
    message: 'Số điện thoại không đúng định dạng di động Việt Nam',
  })
  phone!: string;

  @ApiProperty({
    description: 'Họ và tên đầy đủ của bác sĩ',
    example: 'BS. CKI Nguyễn Văn An',
  })
  @IsNotEmpty({ message: 'Tên bác sĩ không được để trống' })
  @IsString()
  @MinLength(2, { message: 'Tên bác sĩ tối thiểu 2 ký tự' })
  @MaxLength(100, { message: 'Tên bác sĩ tối đa 100 ký tự' })
  doctorName!: string;

  @ApiPropertyOptional({
    description: 'Chuyên khoa y tế',
    example: 'Y học gia đình',
    default: 'Y học gia đình',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'Chuyên khoa tối đa 100 ký tự' })
  specialty?: string;

  @ApiPropertyOptional({
    description: 'Học hàm / học vị (BS, ThS.BS, BS.CKI, ...)',
    example: 'BS.CKI',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50, { message: 'Học hàm / học vị tối đa 50 ký tự' })
  academicTitle?: string;

  @ApiPropertyOptional({
    description: 'Số năm kinh nghiệm hành nghề lâm sàng',
    example: 5,
    default: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Số năm kinh nghiệm phải là số nguyên' })
  @Min(0, { message: 'Số năm kinh nghiệm không thể âm' })
  @Max(60, { message: 'Số năm kinh nghiệm tối đa 60 năm' })
  experienceYears?: number;

  @ApiPropertyOptional({
    description: 'Tóm tắt tiểu sử chuyên môn',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'Tiểu sử chuyên môn tối đa 2000 ký tự' })
  bio?: string;
}

export class ConfirmBulkImportDoctorsDto {
  @ApiProperty({
    description: 'Danh sách tối đa 30 bác sĩ hợp lệ được xác nhận khởi tạo tài khoản',
    type: [ConfirmBulkDoctorItemDto],
  })
  @IsArray({ message: 'Danh sách bác sĩ phải là một mảng' })
  @ArrayMinSize(1, { message: 'Vui lòng chọn ít nhất 1 bác sĩ để khởi tạo' })
  @ArrayMaxSize(MAX_BULK_IMPORT_CONFIRM_BATCH, {
    message: `Mỗi lượt xác nhận chỉ được khởi tạo tối đa ${MAX_BULK_IMPORT_CONFIRM_BATCH} bác sĩ mới`,
  })
  @ValidateNested({ each: true })
  @Type(() => ConfirmBulkDoctorItemDto)
  doctors!: ConfirmBulkDoctorItemDto[];
}

export interface BulkImportCreatedDoctorDto {
  rowNumber?: number;
  doctor: DoctorResponseDto;
  mailSent: boolean;
  mailWarning?: string;
}

export interface BulkImportFailedRowDto {
  rowNumber?: number;
  doctorName: string;
  email: string;
  phone: string;
  reason: string;
}

export interface ConfirmBulkImportDoctorsResponseDto {
  summary: {
    requestedCount: number;
    createdCount: number;
    failedCount: number;
    mailSentCount: number;
    mailFailedCount: number;
  };
  createdDoctors: BulkImportCreatedDoctorDto[];
  failedRows: BulkImportFailedRowDto[];
}
