import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { SortOrder } from './search-public-packages.dto';

export enum DoctorSortBy {
  RATING_AVG = 'ratingAvg',
  EXPERIENCE_YEARS = 'experienceYears',
  DOCTOR_NAME = 'doctorName',
}

export class LookupDoctorDirectoryDto {
  @ApiPropertyOptional({
    description: 'Từ khóa tìm kiếm theo tên bác sĩ, chuyên khoa hoặc tiểu sử',
    example: 'Nguyễn Văn A',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: 'Lọc theo ID cơ sở y tế trực thuộc',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @IsOptional()
  @IsUUID('4')
  facilityId?: string;

  @ApiPropertyOptional({
    description: 'Lọc theo chuyên khoa y tế',
    example: 'Y học gia đình',
  })
  @IsOptional()
  @IsString()
  specialty?: string;

  @ApiPropertyOptional({
    description: 'Số năm kinh nghiệm tối thiểu',
    example: 5,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minExperienceYears?: number;

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
    description: 'Số lượng bác sĩ mỗi trang (tối đa 50)',
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
    enum: DoctorSortBy,
    default: DoctorSortBy.RATING_AVG,
  })
  @IsOptional()
  @IsEnum(DoctorSortBy)
  sortBy: DoctorSortBy = DoctorSortBy.RATING_AVG;

  @ApiPropertyOptional({
    description: 'Thứ tự sắp xếp (asc: tăng dần, desc: giảm dần)',
    enum: SortOrder,
    default: SortOrder.DESC,
  })
  @IsOptional()
  @IsEnum(SortOrder)
  sortOrder: SortOrder = SortOrder.DESC;
}
