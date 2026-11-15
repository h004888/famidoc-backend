import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PLATFORM_CARE_CATEGORIES } from './create-platform-care-item.dto';
import type { PlatformCareCategoryValue } from './create-platform-care-item.dto';

export class UpdatePlatformCareItemDto {
  @ApiPropertyOptional({
    description: 'Nhóm nội dung chăm sóc',
    enum: PLATFORM_CARE_CATEGORIES,
    example: 'COMMITMENT',
  })
  @IsOptional()
  @IsIn(PLATFORM_CARE_CATEGORIES, {
    message: 'Nhóm nội dung phải là SERVICE_MODE hoặc COMMITMENT',
  })
  category?: PlatformCareCategoryValue;

  @ApiPropertyOptional({ description: 'Tiêu đề hiển thị' })
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'Tiêu đề phải có tối thiểu 2 ký tự' })
  @MaxLength(150, { message: 'Tiêu đề tối đa 150 ký tự' })
  title?: string;

  @ApiPropertyOptional({ description: 'Mô tả chi tiết' })
  @IsOptional()
  @IsString()
  @MaxLength(1000, { message: 'Mô tả tối đa 1000 ký tự' })
  description?: string;

  @ApiPropertyOptional({ description: 'Biểu tượng hiển thị' })
  @IsOptional()
  @IsString()
  @MaxLength(50, { message: 'Biểu tượng tối đa 50 ký tự' })
  icon?: string;

  @ApiPropertyOptional({ description: 'Thứ tự hiển thị' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({ description: 'Trạng thái hoạt động' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
