import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { DoctorTier } from '../pricing/doctor-pricing';

// Chỉ nhận số người muốn đăng ký phục vụ, không nhận giá hay hạn mức từ client.
export class QuoteCarePackageDto {
  @ApiPropertyOptional({
    enum: DoctorTier,
    default: DoctorTier.STANDARD,
    description:
      'Chỉ chọn loại để xem báo giá; hợp đồng lấy học vị bác sĩ từ DB.',
  })
  @IsOptional()
  @IsEnum(DoctorTier)
  doctorTier?: DoctorTier;
  @ApiPropertyOptional({
    minimum: 0,
    maximum: 100,
    description: 'Lượt khám tại nhà mua thêm ngay từ đầu kỳ.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  extraHomeVisits?: number;
  @ApiPropertyOptional({
    minimum: 1,
    maximum: 100000,
    description: 'Chốt quota video gói năm, không phải mua video lẻ.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100_000)
  videoConsultations?: number;
  // Số nguyên từ 1 đến trần kỹ thuật; mức tối đa của từng gói được kiểm tra tiếp.
  @ApiProperty({ minimum: 1, maximum: 100 })
  @IsInt()
  @Min(1)
  @Max(100)
  memberCount: number;
}
