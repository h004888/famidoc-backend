import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ChronicClinicalStatus } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateChronicConditionDto {
  @ApiProperty({ description: 'Tên bệnh nền mạn tính', example: 'Tăng huyết áp' })
  @IsNotEmpty({ message: 'Vui lòng nhập tên bệnh nền' })
  @IsString()
  @MaxLength(150)
  conditionName!: string;

  @ApiPropertyOptional({ description: 'Mã bệnh ICD-10 (tùy chọn)', example: 'I10' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  icd10Code?: string;

  @ApiPropertyOptional({
    enum: ChronicClinicalStatus,
    description: 'Tình trạng kiểm soát lâm sàng',
    default: ChronicClinicalStatus.ACTIVE,
  })
  @IsOptional()
  @IsEnum(ChronicClinicalStatus)
  clinicalStatus?: ChronicClinicalStatus;

  @ApiPropertyOptional({
    description: 'Ngày hoặc năm phát hiện (YYYY-MM-DD)',
    example: '2022-03-15',
  })
  @IsOptional()
  @IsDateString()
  diagnosedAt?: string;

  @ApiPropertyOptional({ description: 'Ghi chú thêm cho bác sĩ', example: 'Đang uống Amlodipine 5mg' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
