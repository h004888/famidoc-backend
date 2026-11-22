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
  return typeof value === 'string' && /^\d+$/.test(value)
    ? Number(value)
    : value;
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
  @IsInt({ message: 'Năm đối soát phải là số nguyên.' })
  @Min(2000, { message: 'Năm đối soát phải từ 2000 trở lên.' })
  @Max(2200, { message: 'Năm đối soát không được vượt quá 2200.' })
  year?: number;

  @ApiPropertyOptional({
    description: 'Tháng tài chính cần truy vấn (1 - 12)',
    example: 11,
    minimum: 1,
    maximum: 12,
  })
  @ValidateIf((_dto, value) => value !== undefined)
  @Transform(parsePeriodNumber)
  @IsInt({ message: 'Tháng đối soát phải là số nguyên.' })
  @Min(1, { message: 'Tháng đối soát phải từ 1 đến 12.' })
  @Max(12, { message: 'Tháng đối soát phải từ 1 đến 12.' })
  month?: number;

  @ApiPropertyOptional({
    enum: ['TEST', 'LIVE'],
    description: 'Môi trường dữ liệu (TEST: thử nghiệm, LIVE: thực tế)',
    default: 'LIVE',
    example: 'LIVE',
  })
  @IsIn(['TEST', 'LIVE'], {
    message: 'Môi trường dữ liệu chỉ chấp nhận LIVE hoặc TEST.',
  })
  environment: 'TEST' | 'LIVE' = 'LIVE';
}

export class RevenueAnalyticsQueryDto extends ReportingPeriodDto {
  @ApiPropertyOptional({
    description: 'UUID của cơ sở y tế cần lọc báo cáo doanh thu',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @IsOptional()
  @IsUUID('4', { message: 'Mã cơ sở y tế không đúng định dạng UUID.' })
  facilityId?: string;
}

export class RunSePayReconciliationDto {
  @ApiPropertyOptional({
    enum: ['TEST', 'LIVE'],
    description: 'Môi trường SePay cần đối soát',
    default: 'LIVE',
  })
  @IsIn(['TEST', 'LIVE'], {
    message: 'Môi trường đối soát chỉ chấp nhận LIVE hoặc TEST.',
  })
  environment: 'TEST' | 'LIVE' = 'LIVE';

  @ApiPropertyOptional({
    description:
      'Bắt đầu khoảng đối soát theo ISO 8601. Bỏ cả from/to để chạy tăng dần từ cursor.',
    example: '2026-10-01T00:00:00+07:00',
  })
  @ValidateIf(
    (dto: RunSePayReconciliationDto) =>
      dto.from !== undefined || dto.to !== undefined,
  )
  @IsISO8601(
    { strict: true, strictSeparator: true },
    { message: 'Thời điểm bắt đầu (from) phải đúng định dạng ISO 8601.' },
  )
  from?: string;

  @ApiPropertyOptional({
    description:
      'Kết thúc khoảng đối soát theo ISO 8601; bắt buộc đi cùng from, tối đa 31 ngày.',
    example: '2026-10-31T23:59:59+07:00',
  })
  @ValidateIf(
    (dto: RunSePayReconciliationDto) =>
      dto.from !== undefined || dto.to !== undefined,
  )
  @IsISO8601(
    { strict: true, strictSeparator: true },
    { message: 'Thời điểm kết thúc (to) phải đúng định dạng ISO 8601.' },
  )
  to?: string;
}

export class SePayReconciliationQueryDto {
  @ApiPropertyOptional({ enum: ['TEST', 'LIVE'], default: 'LIVE' })
  @IsIn(['TEST', 'LIVE'], {
    message: 'Môi trường dữ liệu chỉ chấp nhận LIVE hoặc TEST.',
  })
  environment: 'TEST' | 'LIVE' = 'LIVE';

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @Transform(parsePeriodNumber)
  @IsInt({ message: 'Số bản ghi mỗi trang phải là số nguyên.' })
  @Min(1, { message: 'Số bản ghi mỗi trang phải từ 1 đến 100.' })
  @Max(100, { message: 'Số bản ghi mỗi trang phải từ 1 đến 100.' })
  limit = 20;
}

export class SettlementEnvironmentDto {
  @ApiPropertyOptional({ enum: ['TEST', 'LIVE'], default: 'LIVE' })
  @IsIn(['TEST', 'LIVE'], {
    message: 'Môi trường dữ liệu chỉ chấp nhận LIVE hoặc TEST.',
  })
  environment: 'TEST' | 'LIVE' = 'LIVE';
}

export class ReviewSettlementDto extends SettlementEnvironmentDto {
  @ApiProperty({ enum: ['CONFIRM', 'REPORT_DISCREPANCY'] })
  @IsIn(['CONFIRM', 'REPORT_DISCREPANCY'], {
    message: 'Hành động đối soát không hợp lệ.',
  })
  action: 'CONFIRM' | 'REPORT_DISCREPANCY';

  @ApiProperty({
    minimum: 1,
    description: 'Phiên bản bảng quyết toán đang được kiểm tra',
  })
  @IsInt({ message: 'Phiên bản bảng quyết toán phải là số nguyên.' })
  @Min(1, { message: 'Phiên bản bảng quyết toán không hợp lệ.' })
  reviewVersion: number;

  @ApiPropertyOptional({
    description: 'Nội dung sai lệch, bắt buộc khi báo sai lệch',
  })
  @FieldFor('action', ['REPORT_DISCREPANCY'])
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'Nội dung sai lệch phải là chuỗi ký tự.' })
  @Length(10, 1000, {
    message: 'Nội dung sai lệch phải từ 10 đến 1000 ký tự.',
  })
  reason?: string;
}

export class MonthlySettlementDto extends ReportingPeriodDto {
  @ApiProperty({
    enum: ['PREPARE', 'CONFIRM_TRANSFER', 'MARK_FAILED', 'REOPEN_REVIEW'],
    description:
      'Lập bảng, xác nhận chuyển khoản, báo thất bại hoặc gửi lại bảng có sai lệch cho CSYT kiểm tra',
    default: 'PREPARE',
    example: 'PREPARE',
  })
  @IsIn(['PREPARE', 'CONFIRM_TRANSFER', 'MARK_FAILED', 'REOPEN_REVIEW'], {
    message: 'Hành động quyết toán không hợp lệ.',
  })
  action: 'PREPARE' | 'CONFIRM_TRANSFER' | 'MARK_FAILED' | 'REOPEN_REVIEW' =
    'PREPARE';

  @ApiPropertyOptional({
    description: 'Lọc theo UUID cơ sở y tế khi lập bảng (PREPARE)',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @FieldFor('action', ['PREPARE'], false)
  @IsUUID('4', { message: 'Mã cơ sở y tế không đúng định dạng UUID.' })
  facilityId?: string;

  @ApiPropertyOptional({
    description: 'UUID của kỳ quyết toán (bắt buộc khi action khác PREPARE)',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @FieldFor('action', ['CONFIRM_TRANSFER', 'MARK_FAILED', 'REOPEN_REVIEW'])
  @IsUUID('4', { message: 'Mã bảng quyết toán không đúng định dạng UUID.' })
  settlementId?: string;

  @ApiPropertyOptional({
    minimum: 1,
    description: 'Phiên bản bảng quyết toán đang hiển thị',
  })
  @FieldFor('action', ['CONFIRM_TRANSFER', 'REOPEN_REVIEW'], false)
  @IsInt({ message: 'Phiên bản bảng quyết toán phải là số nguyên.' })
  @Min(1, { message: 'Phiên bản bảng quyết toán không hợp lệ.' })
  reviewVersion?: number;

  @ApiPropertyOptional({
    description: 'Mã giao dịch / mã lệnh chuyển khoản ngân hàng',
    example: 'FT261110001234',
  })
  @FieldFor('action', ['CONFIRM_TRANSFER'])
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'Mã giao dịch ngân hàng phải là chuỗi ký tự.' })
  @Length(3, 100, {
    message: 'Mã giao dịch trên chứng từ phải từ 3 đến 100 ký tự.',
  })
  bankTransferOrderId?: string;

  @ApiPropertyOptional({
    description: 'Nội dung đã điền khi chuyển tiền cho CSYT.',
  })
  @FieldFor('action', ['CONFIRM_TRANSFER'])
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'Nội dung chuyển khoản phải là chuỗi ký tự.' })
  @Length(1, 140, {
    message: 'Nội dung chuyển khoản phải từ 1 đến 140 ký tự.',
  })
  transferMemo?: string;

  @ApiPropertyOptional({
    description: 'Số tiền thực tế đã giải ngân thanh toán (VNĐ)',
    example: 50000000,
  })
  @FieldFor('action', ['CONFIRM_TRANSFER'])
  @IsInt({ message: 'Số tiền đã chuyển phải là số nguyên (VNĐ).' })
  @Min(1, { message: 'Số tiền đã chuyển phải lớn hơn 0 VNĐ.' })
  @Max(999999999999, {
    message: 'Số tiền đã chuyển không được vượt quá 999.999.999.999 VNĐ.',
  })
  amountPaidVnd?: number;

  @ApiPropertyOptional({
    description:
      'Thời điểm chuyển tiền theo ISO 8601, có giờ, phút, giây và múi giờ',
    example: '2026-11-10T08:00:00.000Z',
  })
  @FieldFor('action', ['CONFIRM_TRANSFER'])
  @IsISO8601(
    { strict: true, strictSeparator: true },
    { message: 'Thời điểm chuyển khoản không đúng định dạng ngày giờ.' },
  )
  @Matches(
    /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-]\d{2}:[0-5]\d)$/,
    {
      message:
        'Thời điểm chuyển khoản phải có đầy đủ giờ, phút, giây và múi giờ.',
    },
  )
  paidAt?: string;

  @ApiPropertyOptional({
    description: 'Khóa tài liệu chứng từ ủy nhiệm chi ngân hàng lưu trữ',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6/settlements/unc_nov2026.pdf',
  })
  @FieldFor('action', ['CONFIRM_TRANSFER'])
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'Đường dẫn chứng từ phải là chuỗi ký tự.' })
  @Length(5, 300, {
    message: 'Đường dẫn chứng từ phải từ 5 đến 300 ký tự.',
  })
  evidenceKey?: string;

  @ApiPropertyOptional({
    description: 'Lý do quyết toán thất bại / không thực hiện được',
    example: 'Sai thông tin tài khoản thụ hưởng của cơ sở y tế',
  })
  @FieldFor('action', ['MARK_FAILED'])
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'Lý do chi trả thất bại phải là chuỗi ký tự.' })
  @Length(10, 1000, {
    message: 'Lý do chi trả thất bại phải từ 10 đến 1000 ký tự.',
  })
  failureReason?: string;
}
