import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export const PLATFORM_CARE_CATEGORIES = ['SERVICE_MODE', 'COMMITMENT'] as const;
export type PlatformCareCategoryValue =
  (typeof PLATFORM_CARE_CATEGORIES)[number];

export class CreatePlatformCareItemDto {
  @ApiProperty({
    description: 'Nhóm nội dung chăm sóc',
    enum: PLATFORM_CARE_CATEGORIES,
    example: 'SERVICE_MODE',
  })
  @IsIn(PLATFORM_CARE_CATEGORIES, {
    message: 'Nhóm nội dung phải là SERVICE_MODE hoặc COMMITMENT',
  })
  category: PlatformCareCategoryValue;

  @ApiProperty({
    description: 'Tiêu đề hiển thị',
    example: 'Khám tận nhà',
  })
  @IsNotEmpty({ message: 'Tiêu đề không được để trống' })
  @IsString()
  @MinLength(2, { message: 'Tiêu đề phải có tối thiểu 2 ký tự' })
  @MaxLength(150, { message: 'Tiêu đề tối đa 150 ký tự' })
  title: string;

  @ApiPropertyOptional({
    description: 'Mô tả chi tiết',
    example: 'Khám lâm sàng tại nhà, đo điện tim ECG và theo dõi định kỳ.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000, { message: 'Mô tả tối đa 1000 ký tự' })
  description?: string;

  @ApiPropertyOptional({
    description: 'Biểu tượng hiển thị',
    example: 'home',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50, { message: 'Biểu tượng tối đa 50 ký tự' })
  icon?: string;

  @ApiPropertyOptional({
    description: 'Thứ tự hiển thị; bỏ trống để xếp cuối nhóm',
    example: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({
    description: 'Trạng thái hoạt động',
    example: true,
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
