import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ComplaintStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { FieldFor } from '../../../core/validation/field-for.decorator';

export const COMPLAINT_CATEGORIES = [
  'DOCTOR_ABSENT',
  'MISSED_VISIT',
  'UNAUTHORIZED_FEE',
  'FAMILY_UNCOOPERATIVE',
  'OTHER',
] as const;

export type ComplaintCategory = (typeof COMPLAINT_CATEGORIES)[number];

export class ListComplaintsQueryDto {
  @ApiPropertyOptional({
    enum: ComplaintStatus,
    description: 'Lọc danh sách khiếu nại theo trạng thái xử lý',
  })
  @IsOptional()
  @IsEnum(ComplaintStatus, { message: 'Trạng thái khiếu nại không hợp lệ.' })
  status?: ComplaintStatus;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Số trang phải là số nguyên.' })
  @Min(1, { message: 'Số trang phải từ 1 trở lên.' })
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Số bản ghi mỗi trang phải là số nguyên.' })
  @Min(1, { message: 'Số bản ghi mỗi trang phải từ 1 trở lên.' })
  @Max(50, { message: 'Số bản ghi mỗi trang tối đa là 50.' })
  limit?: number = 20;
}

export class SubmitIncidentComplaintDto {
  @ApiProperty({
    description: 'UUID của hợp đồng dịch vụ y tế liên quan đến khiếu nại',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @IsUUID('4', { message: 'ID hợp đồng không đúng định dạng UUID hợp lệ.' })
  contractId!: string;

  @ApiPropertyOptional({
    description: 'UUID lượt khám xảy ra sự cố (nếu có)',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @IsOptional()
  @IsUUID('4', { message: 'ID lượt khám không đúng định dạng UUID hợp lệ.' })
  encounterId?: string;

  @ApiProperty({
    enum: COMPLAINT_CATEGORIES,
    description: 'Danh mục khiếu nại / sự cố',
    example: 'MISSED_VISIT',
  })
  @IsIn(COMPLAINT_CATEGORIES, {
    message: 'Danh mục khiếu nại không nằm trong danh sách hỗ trợ.',
  })
  category!: string;

  @ApiProperty({
    description: 'Mô tả chi tiết nội dung sự cố / phản ánh khiếu nại (10 - 4000 ký tự)',
    example: 'Bác sĩ không đến khám theo đúng lịch hẹn đã thống nhất trước đó.',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: 'Mô tả nội dung khiếu nại phải là chuỗi ký tự.' })
  @Length(10, 4000, {
    message: 'Mô tả nội dung khiếu nại phải từ 10 đến 4000 ký tự.',
  })
  description!: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Danh sách khóa tệp tài liệu / hình ảnh bằng chứng đính kèm',
    example: ['complaints/evidence_1.jpg'],
  })
  @IsOptional()
  @IsArray({ message: 'Danh sách tệp bằng chứng phải là mảng chuỗi.' })
  @ArrayMaxSize(10, { message: 'Tối đa đính kèm 10 tệp bằng chứng.' })
  @ArrayUnique({ message: 'Danh sách tệp bằng chứng bị trùng lặp.' })
  @IsString({ each: true, message: 'Mỗi khóa tệp bằng chứng phải là chuỗi ký tự.' })
  @Length(1, 300, {
    each: true,
    message: 'Khóa tệp bằng chứng phải từ 1 đến 300 ký tự.',
  })
  evidenceKeys?: string[];
}

export class ResolveComplaintDto {
  @ApiProperty({
    enum: ['INVESTIGATE', 'FACILITY_RESPONSE', 'RESOLVE', 'CLOSE'],
    description: 'Hành động xử lý khiếu nại (INVESTIGATE: xác minh, FACILITY_RESPONSE: CSYT phản hồi, RESOLVE: giải quyết, CLOSE: đóng)',
    example: 'RESOLVE',
  })
  @IsIn(['INVESTIGATE', 'FACILITY_RESPONSE', 'RESOLVE', 'CLOSE'], {
    message: 'Hành động xử lý khiếu nại không hợp lệ.',
  })
  action!: string;

  @ApiPropertyOptional({
    description: 'Bắt buộc với FACILITY_RESPONSE và RESOLVE. Các bước mở hoặc đóng hồ sơ không cần ghi chú.',
    example: 'Đã nhắc nhở bác sĩ và sắp xếp lịch khám bù cho gia đình trong tuần này.',
  })
  @ValidateIf(
    (dto, value) =>
      value !== undefined ||
      dto.action === 'FACILITY_RESPONSE' ||
      dto.action === 'RESOLVE',
  )
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: 'Nội dung ghi chú / phán quyết phải là chuỗi ký tự.' })
  @Length(10, 4000, {
    message: 'Nội dung ghi chú / phán quyết phải từ 10 đến 4000 ký tự.',
  })
  notes?: string;

  // Chỉ có biện pháp phi tài chính; không có trường tiền hoàn/bồi thường.
  @ApiPropertyOptional({
    enum: [
      'NO_VIOLATION',
      'WARNING',
      'SERVICE_CORRECTION',
      'REFERRED_TO_FACILITY',
    ],
    description: 'Kết quả phân định khiếu nại (bắt buộc khi action là RESOLVE)',
    example: 'SERVICE_CORRECTION',
  })
  @FieldFor('action', ['RESOLVE'])
  @IsIn(
    [
      'NO_VIOLATION',
      'WARNING',
      'SERVICE_CORRECTION',
      'REFERRED_TO_FACILITY',
    ],
    { message: 'Kết quả phân định khiếu nại không hợp lệ.' },
  )
  outcome?: string;
}
