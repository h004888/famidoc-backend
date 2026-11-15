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
import { DoctorOnboardingStatus } from '@prisma/client';

export class ListDoctorsQueryDto {
  @ApiPropertyOptional({
    description: 'Lọc theo ID cơ sở y tế (chỉ khả dụng cho Admin)',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @IsOptional()
  @IsUUID('4', { message: 'facilityId phải là UUID hợp lệ' })
  facilityId?: string;

  @ApiPropertyOptional({
    description: 'Lọc theo trạng thái tiến trình thẩm định của Bác sĩ',
    enum: DoctorOnboardingStatus,
    example: DoctorOnboardingStatus.FACILITY_VERIFIED,
  })
  @IsOptional()
  @IsEnum(DoctorOnboardingStatus, {
    message: 'onboardingStatus phải là giá trị hợp lệ trong enum DoctorOnboardingStatus',
  })
  onboardingStatus?: DoctorOnboardingStatus;

  @ApiPropertyOptional({
    description: 'Từ khóa tìm kiếm theo họ tên hoặc chuyên khoa của bác sĩ',
    example: 'Nguyễn Văn An',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: 'Số thứ tự trang (bắt đầu từ 1)',
    default: 1,
    example: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({
    description: 'Số lượng bản ghi mỗi trang (tối đa 50)',
    default: 10,
    example: 10,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 10;
}
