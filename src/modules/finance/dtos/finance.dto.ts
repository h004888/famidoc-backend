import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateIf,
  IsISO8601,
} from 'class-validator';

export class RevenueAnalyticsQueryDto {
  @ApiPropertyOptional({
    description: 'Năm tài chính cần truy vấn (2000 - 2200)',
    example: 2026,
    minimum: 2000,
    maximum: 2200,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2200)
  year?: number;

  @ApiPropertyOptional({
    description: 'Tháng tài chính cần truy vấn (1 - 12)',
    example: 11,
    minimum: 1,
    maximum: 12,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month?: number;

  @ApiPropertyOptional({
    description: 'UUID của cơ sở y tế cần lọc báo cáo doanh thu',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @IsOptional()
  @IsUUID('4')
  facilityId?: string;

  @ApiPropertyOptional({
    enum: ['TEST', 'LIVE'],
    description: 'Môi trường dữ liệu (TEST: thử nghiệm, LIVE: thực tế)',
    default: 'LIVE',
    example: 'LIVE',
  })
  @IsOptional()
  @IsIn(['TEST', 'LIVE'])
  environment: 'TEST' | 'LIVE' = 'LIVE';
}

export class MonthlySettlementDto extends RevenueAnalyticsQueryDto {
  @ApiProperty({
    enum: ['PREPARE', 'CONFIRM_TRANSFER', 'MARK_FAILED'],
    description: 'Hành động quyết toán hàng tháng (PREPARE: lập bảng đối soát, CONFIRM_TRANSFER: xác nhận chuyển khoản, MARK_FAILED: báo thất bại)',
    default: 'PREPARE',
    example: 'PREPARE',
  })
  @IsIn(['PREPARE', 'CONFIRM_TRANSFER', 'MARK_FAILED'])
  action: 'PREPARE' | 'CONFIRM_TRANSFER' | 'MARK_FAILED' = 'PREPARE';

  @ApiPropertyOptional({
    description: 'UUID của kỳ quyết toán (bắt buộc khi action khác PREPARE)',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @ValidateIf((o) => o.action !== 'PREPARE')
  @IsUUID('4')
  settlementId?: string;

  @ApiPropertyOptional({
    description: 'Mã giao dịch / mã lệnh chuyển khoản ngân hàng',
    example: 'FT261110001234',
  })
  @ValidateIf((o) => o.action === 'CONFIRM_TRANSFER')
  @IsString()
  @Length(3, 100)
  bankTransferOrderId?: string;

  @ApiPropertyOptional({
    description: 'Số tiền thực tế đã giải ngân thanh toán (VNĐ)',
    example: 50000000,
  })
  @ValidateIf((o) => o.action === 'CONFIRM_TRANSFER')
  @IsInt()
  @Min(1)
  @Max(999999999999)
  amountPaidVnd?: number;

  @ApiPropertyOptional({
    description: 'Thời điểm chuyển tiền thành công theo chuẩn ISO8601',
    example: '2026-11-10T08:00:00.000Z',
  })
  @ValidateIf((o) => o.action === 'CONFIRM_TRANSFER')
  @IsISO8601({ strict: true })
  paidAt?: string;

  @ApiPropertyOptional({
    description: 'Khóa tài liệu chứng từ ủy nhiệm chi ngân hàng lưu trữ',
    example: 'settlements/unc_nov2026.pdf',
  })
  @ValidateIf((o) => o.action === 'CONFIRM_TRANSFER')
  @IsString()
  @Length(5, 300)
  evidenceKey?: string;

  @ApiPropertyOptional({
    description: 'Lý do quyết toán thất bại / không thực hiện được',
    example: 'Sai thông tin tài khoản thụ hưởng của cơ sở y tế',
  })
  @ValidateIf((o) => o.action === 'MARK_FAILED')
  @IsString()
  @Length(10, 1000)
  failureReason?: string;
}
