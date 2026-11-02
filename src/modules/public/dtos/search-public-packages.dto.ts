import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export enum PackageSortBy {
  BASE_PRICE = 'basePrice',
  CREATED_AT = 'createdAt',
  DURATION_MONTHS = 'durationMonths',
  PACKAGE_NAME = 'packageName',
}

export enum SortOrder {
  ASC = 'asc',
  DESC = 'desc',
}

export class SearchPublicPackagesDto {
  @ApiPropertyOptional({
    description: 'Từ khóa tìm kiếm theo mã gói, tên gói hoặc mô tả',
    example: 'Gia đình',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: 'Thời hạn gói theo số tháng (ví dụ: 6, 12 tháng)',
    example: 12,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  durationMonths?: number;

  @ApiPropertyOptional({
    description: 'Giá gói tối thiểu (VNĐ)',
    example: 5000000,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minPrice?: number;

  @ApiPropertyOptional({
    description: 'Giá gói tối đa (VNĐ)',
    example: 20000000,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxPrice?: number;

  @ApiPropertyOptional({
    description: 'Số lượng thành viên tối thiểu cần được bảo hiểm trong gói',
    example: 4,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxMembers?: number;

  @ApiPropertyOptional({
    description: 'Trang hiện tại (bắt đầu từ 1)',
    default: 1,
    example: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({
    description: 'Số lượng gói mỗi trang (tối đa 50)',
    default: 10,
    example: 10,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 10;

  @ApiPropertyOptional({
    description: 'Trường sắp xếp kết quả',
    enum: PackageSortBy,
    default: PackageSortBy.BASE_PRICE,
  })
  @IsOptional()
  @IsEnum(PackageSortBy)
  sortBy: PackageSortBy = PackageSortBy.BASE_PRICE;

  @ApiPropertyOptional({
    description: 'Thứ tự sắp xếp (asc: tăng dần, desc: giảm dần)',
    enum: SortOrder,
    default: SortOrder.ASC,
  })
  @IsOptional()
  @IsEnum(SortOrder)
  sortOrder: SortOrder = SortOrder.ASC;
}
