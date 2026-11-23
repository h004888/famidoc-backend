import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Gender } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { CreateChronicConditionDto } from './create-chronic-condition.dto';

export class CreatePatientDto {
  @ApiProperty({ description: 'Họ và tên bệnh nhân', example: 'Nguyễn Văn Con' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  fullName!: string;

  @ApiProperty({ description: 'Ngày tháng năm sinh (định dạng YYYY-MM-DD)', example: '2015-05-20' })
  @IsNotEmpty()
  @IsDateString()
  dateOfBirth!: string;

  @ApiProperty({ enum: Gender, description: 'Giới tính sinh học', example: Gender.MALE })
  @IsNotEmpty()
  @IsEnum(Gender)
  gender!: Gender;

  @ApiPropertyOptional({
    description: 'Mối quan hệ nhân thân với chủ hộ / đại diện gia đình (BỐ, MẸ, CON, VỢ, CHỒNG, BẢN THÂN...)',
    example: 'CON',
  })
  @ValidateIf(
    (o: CreatePatientDto) =>
      o.relationshipToRepresentative !== undefined || !o.relationshipToHead?.trim(),
  )
  @IsNotEmpty({ message: 'Vui lòng cung cấp quan hệ với chủ hộ / đại diện gia đình' })
  @IsString()
  @MaxLength(50)
  relationshipToRepresentative?: string;

  @ApiPropertyOptional({ description: 'Mối quan hệ nhân thân (alias của relationshipToRepresentative)' })
  @ValidateIf(
    (o: CreatePatientDto) =>
      o.relationshipToHead !== undefined || !o.relationshipToRepresentative?.trim(),
  )
  @IsNotEmpty({ message: 'Vui lòng cung cấp quan hệ với chủ hộ / đại diện gia đình' })
  @IsString()
  @MaxLength(50)
  relationshipToHead?: string;

  @ApiPropertyOptional({ description: 'Nhóm máu (A, B, AB, O...)', example: 'O+' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  bloodType?: string;

  @ApiPropertyOptional({ description: 'Chiều cao (cm)', example: 168.5, minimum: 30, maximum: 250 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'Chiều cao phải là số hợp lệ' })
  @Min(30, { message: 'Chiều cao tối thiểu là 30 cm' })
  @Max(250, { message: 'Chiều cao tối đa là 250 cm' })
  heightCm?: number | null;

  @ApiPropertyOptional({ description: 'Cân nặng (kg)', example: 62.0, minimum: 1, maximum: 300 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'Cân nặng phải là số hợp lệ' })
  @Min(1, { message: 'Cân nặng tối thiểu là 1 kg' })
  @Max(300, { message: 'Cân nặng tối đa là 300 kg' })
  weightKg?: number | null;

  @ApiPropertyOptional({ description: 'Bệnh nền đang theo dõi', example: 'Tăng huyết áp, Dạ dày' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  chronicDiseases?: string;

  @ApiPropertyOptional({
    type: [CreateChronicConditionDto],
    description: 'Danh sách bệnh nền có cấu trúc',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateChronicConditionDto)
  chronicConditions?: CreateChronicConditionDto[];

  @ApiPropertyOptional({ description: 'ID hộ gia đình (bắt buộc khi ADMIN tạo hộ)' })
  @IsOptional()
  @IsUUID('4')
  familyId?: string;
}
