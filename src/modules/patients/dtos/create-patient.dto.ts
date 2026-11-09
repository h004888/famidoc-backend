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

  @ApiProperty({
    description: 'Mối quan hệ nhân thân với chủ hộ / đại diện gia đình (BỐ, MẸ, CON, VỢ, CHỒNG, BẢN THÂN...)',
    example: 'CON',
  })
  @IsNotEmpty()
  @IsString()
  @MaxLength(50)
  relationshipToRepresentative!: string;

  @ApiPropertyOptional({ description: 'Số CCCD/Định danh cá nhân', example: '001201500001' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  identityNumber?: string;

  @ApiPropertyOptional({ description: 'Số CCCD/Định danh cá nhân (alias của identityNumber)' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  citizenId?: string;

  @ApiPropertyOptional({ description: 'Mối quan hệ nhân thân (alias của relationshipToRepresentative)' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  relationshipToHead?: string;

  @ApiPropertyOptional({ description: 'Số điện thoại liên hệ cá nhân', example: '0987654321' })
  @IsOptional()
  @IsString()
  @MaxLength(15)
  phoneNumber?: string;

  @ApiPropertyOptional({ description: 'Nhóm máu (A, B, AB, O...)', example: 'O+' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  bloodType?: string;

  @ApiPropertyOptional({ description: 'Mã số thẻ bảo hiểm y tế', example: 'DN4010123456789' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  healthInsuranceNumber?: string;

  @ApiPropertyOptional({ description: 'ID hộ gia đình (bắt buộc khi ADMIN tạo hộ)' })
  @IsOptional()
  @IsUUID('4')
  familyId?: string;
}
