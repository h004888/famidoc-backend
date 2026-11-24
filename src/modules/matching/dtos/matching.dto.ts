import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { DoctorClinicalTier, MatchingQueueStatus } from '@prisma/client';

export class MatchDoctorsIntakeDto {
  @ApiProperty({
    description: 'ID gói chăm sóc sức khỏe đã chọn',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @IsUUID('4')
  @IsNotEmpty()
  packageId!: string;

  @ApiProperty({
    description: 'Số lượng thành viên trong hộ gia đình đăng ký gói',
    example: 4,
    minimum: 1,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  memberCount!: number;

  @ApiPropertyOptional({
    enum: DoctorClinicalTier,
    description: 'Trình độ bác sĩ mong muốn (để trống nếu không giới hạn)',
  })
  @IsOptional()
  @IsEnum(DoctorClinicalTier)
  requestedTier?: DoctorClinicalTier;

  @ApiPropertyOptional({
    description: 'Học hàm / học vị bác sĩ mong muốn (ví dụ: BS, BSNT, ThS.BS, BS.CKI, BS.CKII, TS.BS, PGS.TS.BS, GS.TS.BS)',
    example: 'BS.CKI',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  requestedAcademicTitle?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Nhóm đối tượng trong hộ gia đình (ví dụ: Trẻ nhỏ, Người cao tuổi)',
    example: ['Trẻ nhỏ (< 12 tuổi)', 'Người cao tuổi (> 60 tuổi)'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  ageGroups?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Nhóm nhu cầu chăm sóc / bệnh nền chính',
    example: ['Tăng huyết áp / Tim mạch', 'Theo dõi nhi khoa định kỳ'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  careCategories?: string[];

  @ApiPropertyOptional({
    description: 'Quận / Huyện hoặc khu vực sinh sống',
    example: 'Quận 1, TP.HCM',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  districtArea?: string;

  @ApiPropertyOptional({
    description: 'Mô tả nhu cầu chăm sóc sức khỏe (không nhập thông tin định danh PII)',
    example: 'Gia đình có ông bà bị tăng huyết áp nhẹ cần bác sĩ theo dõi định kỳ tại nhà.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1500)
  careDescription?: string;
}

export class AssignQueueDoctorDto {
  @ApiProperty({
    description: 'UUID của bác sĩ còn slot được Admin phân công',
  })
  @IsUUID('4')
  @IsNotEmpty()
  doctorId!: string;

  @ApiPropertyOptional({
    description: 'Ghi chú điều phối của Quản trị viên',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  adminNote?: string;
}

export class CancelMatchingQueueDto {
  @ApiPropertyOptional({
    description: 'Lý do hủy yêu cầu chờ điều phối',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class ListMatchingQueueQueryDto {
  @ApiPropertyOptional({ enum: MatchingQueueStatus })
  @IsOptional()
  @IsEnum(MatchingQueueStatus)
  status?: MatchingQueueStatus;

  @ApiPropertyOptional({ example: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ example: 20, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
