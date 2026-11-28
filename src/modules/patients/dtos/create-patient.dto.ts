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
  registerDecorator,
  ValidateIf,
  ValidateNested,
  type ValidationOptions,
} from 'class-validator';
import { isFutureBirthDate } from '../utils/profile-completeness.util';
import { CreateChronicConditionDto } from './create-chronic-condition.dto';

function IsNotFutureDate(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isNotFutureDate',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          if (typeof value !== 'string' || !value.trim()) return true;
          return !isFutureBirthDate(value);
        },
      },
    });
  };
}

export class CreatePatientDto {
  @ApiProperty({ description: 'Họ và tên bệnh nhân', example: 'Nguyễn Văn Con' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  fullName!: string;

  @ApiPropertyOptional({ description: 'Ngày tháng năm sinh (định dạng YYYY-MM-DD)', example: '2015-05-20' })
  @IsOptional()
  @IsDateString({}, { message: 'Ngày sinh không đúng định dạng YYYY-MM-DD.' })
  @IsNotFutureDate({ message: 'Ngày sinh không được ở tương lai.' })
  dateOfBirth?: string;

  @ApiPropertyOptional({ enum: Gender, description: 'Giới tính sinh học', example: Gender.MALE })
  @IsOptional()
  @IsEnum(Gender, { message: 'Giới tính không hợp lệ.' })
  gender?: Gender;

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
