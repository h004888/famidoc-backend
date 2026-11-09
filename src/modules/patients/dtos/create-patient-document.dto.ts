import { ApiProperty } from '@nestjs/swagger';
import { PatientDocumentType } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreatePatientDocumentDto {
  @ApiProperty({ description: 'Tên tài liệu / hồ sơ y tế', example: 'Phiếu xét nghiệm máu' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(200)
  documentName!: string;

  @ApiProperty({
    enum: PatientDocumentType,
    description: 'Loại tài liệu y tế',
    example: PatientDocumentType.LAB_RESULT,
  })
  @IsNotEmpty()
  @IsEnum(PatientDocumentType)
  documentType!: PatientDocumentType;

  @ApiProperty({
    description: 'Đường dẫn liên kết tải tệp tài liệu',
    example: 'https://storage.famidoc.vn/docs/blood_test.pdf',
  })
  @IsNotEmpty()
  @IsString()
  @MaxLength(255)
  fileUrl!: string;

  @ApiProperty({ description: 'Kích thước tệp tin (KB)', example: 1024 })
  @IsNotEmpty()
  @IsInt()
  @Min(0)
  fileSizeKb!: number;

  @ApiProperty({ description: 'Ngày ghi nhận tài liệu y tế (YYYY-MM-DD)', example: '2026-11-01' })
  @IsNotEmpty()
  @IsDateString()
  recordedDate!: string;
}
