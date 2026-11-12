import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
  IsISO8601,
} from 'class-validator';
import { FieldFor } from '../../../core/validation/field-for.decorator';

// Query gửi số dưới dạng chuỗi. Chỉ đổi chuỗi chữ số để body true/null vẫn bị từ chối.
function parsePeriodNumber({ value }: { value: unknown }) {
  return typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
}

class ReportingPeriodDto {
  @ApiPropertyOptional({
    description: 'Năm tài chính cần truy vấn (2000 - 2200)',
    example: 2026,
    minimum: 2000,
    maximum: 2200,
  })
  @ValidateIf((_dto, value) => value !== undefined)
  @Transform(parsePeriodNumber)
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
  @ValidateIf((_dto, value) => value !== undefined)
  @Transform(parsePeriodNumber)
  @IsInt()
  @Min(1)
  @Max(12)
  month?: number;

  @ApiPropertyOptional({
    enum: ['TEST', 'LIVE'],
    description: 'Môi trường dữ liệu (TEST: thử nghiệm, LIVE: thực tế)',
    default: 'LIVE',
    example: 'LIVE',
  })
  @IsIn(['TEST', 'LIVE'])
  environment: 'TEST' | 'LIVE' = 'LIVE';
}

export class RevenueAnalyticsQueryDto extends ReportingPeriodDto {
  @ApiPropertyOptional({
    description: 'UUID của cơ sở y tế cần lọc báo cáo doanh thu',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @IsOptional()
  @IsUUID('4')
  facilityId?: string;
}

export class MonthlySettlementDto extends ReportingPeriodDto {
  @ApiProperty({
    enum: ['PREPARE', 'CONFIRM_TRANSFER', 'MARK_FAILED'],
    description: 'Hành động quyết toán hàng tháng (PREPARE: lập bảng đối soát, CONFIRM_TRANSFER: xác nhận chuyển khoản, MARK_FAILED: báo thất bại)',
    default: 'PREPARE',
    example: 'PREPARE',
  })
  @IsIn(['PREPARE', 'CONFIRM_TRANSFER', 'MARK_FAILED'])
  action: 'PREPARE' | 'CONFIRM_TRANSFER' | 'MARK_FAILED' = 'PREPARE';

  @ApiPropertyOptional({
    description: 'Lọc theo UUID cơ sở y tế khi lập bảng (PREPARE)',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @FieldFor('action', ['PREPARE'], false)
  @IsUUID('4')
  facilityId?: string;

  @ApiPropertyOptional({
    description: 'UUID của kỳ quyết toán (bắt buộc khi action khác PREPARE)',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @FieldFor('action', ['CONFIRM_TRANSFER', 'MARK_FAILED'])
  @IsUUID('4')
  settlementId?: string;

  @ApiPropertyOptional({
    description: 'Mã giao dịch / mã lệnh chuyển khoản ngân hàng',
    example: 'FT261110001234',
  })
  @FieldFor('action', ['CONFIRM_TRANSFER'])
  @IsString()
  @Length(3, 100)
  bankTransferOrderId?: string;

  @ApiPropertyOptional({
    description: 'Số tiền thực tế đã giải ngân thanh toán (VNĐ)',
    example: 50000000,
  })
  @FieldFor('action', ['CONFIRM_TRANSFER'])
  @IsInt()
  @Min(1)
  @Max(999999999999)
  amountPaidVnd?: number;

  @ApiPropertyOptional({
    description: 'Thời điểm chuyển tiền theo ISO 8601, có giờ, phút, giây và múi giờ',
    example: '2026-11-10T08:00:00.000Z',
  })
  @FieldFor('action', ['CONFIRM_TRANSFER'])
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(
    /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-]\d{2}:[0-5]\d)$/,
    { message: 'paidAt phải có giờ và múi giờ, ví dụ 2026-11-10T15:00:00+07:00.' },
  )
  paidAt?: string;

  @ApiPropertyOptional({
    description: 'Khóa tài liệu chứng từ ủy nhiệm chi ngân hàng lưu trữ',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6/settlements/unc_nov2026.pdf',
  })
  @FieldFor('action', ['CONFIRM_TRANSFER'])
  @IsString()
  @Length(5, 300)
  evidenceKey?: string;

  @ApiPropertyOptional({
    description: 'Lý do quyết toán thất bại / không thực hiện được',
    example: 'Sai thông tin tài khoản thụ hưởng của cơ sở y tế',
  })
  @FieldFor('action', ['MARK_FAILED'])
  @IsString()
  @Length(10, 1000)
  failureReason?: string;
}
