import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { FieldFor } from '../../../core/validation/field-for.decorator';

export class SubmitIncidentComplaintDto {
  @ApiProperty({
    description: 'UUID của hợp đồng dịch vụ y tế liên quan đến khiếu nại',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @IsUUID('4')
  contractId!: string;

  @ApiPropertyOptional({
    description: 'UUID lượt khám xảy ra sự cố (nếu có)',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @IsOptional()
  @IsUUID('4')
  encounterId?: string;

  @ApiProperty({
    enum: [
      'DOCTOR_ABSENT',
      'MISSED_VISIT',
      'UNAUTHORIZED_FEE',
      'FAMILY_UNCOOPERATIVE',
      'OTHER',
    ],
    description: 'Danh mục khiếu nại / sự cố',
    example: 'MISSED_VISIT',
  })
  @IsIn([
    'DOCTOR_ABSENT',
    'MISSED_VISIT',
    'UNAUTHORIZED_FEE',
    'FAMILY_UNCOOPERATIVE',
    'OTHER',
  ])
  category!: string;

  @ApiProperty({
    description: 'Mô tả chi tiết nội dung sự cố / phản ánh khiếu nại (10 - 4000 ký tự)',
    example: 'Bác sĩ không đến khám theo đúng lịch hẹn đã thống nhất trước đó.',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(10, 4000)
  description!: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Danh sách khóa tệp tài liệu / hình ảnh bằng chứng đính kèm',
    example: ['complaints/evidence_1.jpg'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ArrayUnique()
  @IsString({ each: true })
  @Length(1, 300, { each: true })
  evidenceKeys?: string[];
}

export class ResolveComplaintDto {
  @ApiProperty({
    enum: ['INVESTIGATE', 'FACILITY_RESPONSE', 'RESOLVE', 'CLOSE'],
    description: 'Hành động xử lý khiếu nại (INVESTIGATE: xác minh, FACILITY_RESPONSE: CSYT phản hồi, RESOLVE: giải quyết, CLOSE: đóng)',
    example: 'RESOLVE',
  })
  @IsIn(['INVESTIGATE', 'FACILITY_RESPONSE', 'RESOLVE', 'CLOSE'])
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
  @IsString()
  @Length(10, 4000)
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
  @IsIn([
    'NO_VIOLATION',
    'WARNING',
    'SERVICE_CORRECTION',
    'REFERRED_TO_FACILITY',
  ])
  outcome?: string;
}
