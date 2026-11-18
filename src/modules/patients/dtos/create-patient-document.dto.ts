import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PatientDocumentType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreatePatientDocumentDto {
  @ApiProperty({ description: 'Tên tài liệu / hồ sơ y tế', example: 'Đơn thuốc tim mạch T11' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(200)
  documentName!: string;

  @ApiProperty({
    enum: PatientDocumentType,
    description: 'Loại tài liệu y tế',
    example: PatientDocumentType.PRESCRIPTION,
  })
  @IsNotEmpty()
  @IsEnum(PatientDocumentType)
  documentType!: PatientDocumentType;

  @ApiPropertyOptional({
    description: 'Đường dẫn tệp hoặc s3Key (bỏ qua nếu tải file trực tiếp qua multipart)',
    example: 'https://storage.famidoc.vn/docs/blood_test.pdf',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  fileUrl?: string;

  @ApiPropertyOptional({ description: 'Loại MIME của tệp', example: 'application/pdf' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  mimeType?: string;

  @ApiPropertyOptional({
    description: 'Ghi chú nơi khám / bác sĩ kê đơn',
    example: 'BV Đại học Y Dược - TS.BS Hùng',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @ApiPropertyOptional({ description: 'Kích thước tệp tin (KB)', example: 1024 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  fileSizeKb?: number;

  @ApiProperty({ description: 'Ngày ghi nhận tài liệu y tế (YYYY-MM-DD)', example: '2026-11-01' })
  @IsNotEmpty()
  @IsDateString()
  recordedDate!: string;
}
