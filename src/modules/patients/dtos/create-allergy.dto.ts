import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AllergenType, AllergySeverity } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateAllergyDto {
  @ApiProperty({
    enum: AllergenType,
    description: 'Nhóm dị nguyên (DRUG: thuốc, FOOD: thực phẩm, ENVIRONMENTAL: môi trường)',
    example: AllergenType.DRUG,
  })
  @IsNotEmpty()
  @IsEnum(AllergenType)
  allergenType!: AllergenType;

  @ApiProperty({ description: 'Tên dị nguyên gây dị ứng', example: 'Paracetamol' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(150)
  allergenName!: string;

  @ApiProperty({
    enum: AllergySeverity,
    description: 'Mức độ nghiêm trọng (MILD: nhẹ, MODERATE: trung bình, LIFE_THREATENING_ANAPHYLAXIS: sốc phản vệ)',
    example: AllergySeverity.MODERATE,
  })
  @IsNotEmpty()
  @IsEnum(AllergySeverity)
  severity!: AllergySeverity;

  @ApiPropertyOptional({
    description: 'Triệu chứng lâm sàng khi tiếp xúc (mẩn ngứa, khó thở, phù mạch...)',
    example: 'Phát ban ngứa toàn thân',
  })
  @IsOptional()
  @IsString()
  clinicalManifestation?: string;
}
