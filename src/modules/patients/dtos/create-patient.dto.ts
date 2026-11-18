import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Gender } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';

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

  @ApiPropertyOptional({ description: 'Bệnh nền đang theo dõi', example: 'Tăng huyết áp, Dạ dày' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  chronicDiseases?: string;

  @ApiPropertyOptional({ description: 'ID hộ gia đình (bắt buộc khi ADMIN tạo hộ)' })
  @IsOptional()
  @IsUUID('4')
  familyId?: string;
}
