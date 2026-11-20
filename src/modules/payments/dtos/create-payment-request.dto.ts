import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';

// Số tiền, mã chuyển khoản, tài khoản nhận và thời hạn đều do backend xác định.
export class CreatePaymentRequestDto {
  @ApiProperty({
    description: 'UUID của hợp đồng y tế cần tạo yêu cầu thanh toán VietQR',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @IsUUID('4')
  contractId!: string;

  @ApiPropertyOptional({
    description: 'UUID của phụ lục hợp đồng (nếu thanh toán cho phụ lục phát sinh)',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @IsOptional()
  @IsUUID('4')
  addendumId?: string;
}

export class AdminPaymentRequestDto extends CreatePaymentRequestDto {
  @ApiProperty({ minimum: 1, maximum: 9999999999 })
  @IsInt()
  @Min(1)
  @Max(9999999999)
  amountVnd!: number;

  @ApiProperty({ description: 'Phần mô tả ngân hàng. Hệ thống thêm mã FD của hóa đơn.' })
  @Transform(({ value }) => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').toUpperCase() : value)
  @IsString()
  // VietQR nhận tối đa 94 ký tự, chừa 1 dấu cách và 8 ký tự cho mã FD.
  @Length(1, 85)
  @Matches(/^[A-Z0-9][A-Z0-9 ]*$/)
  transferDescription!: string;

  @ApiProperty({ description: 'Lý do điều chỉnh để ghi vào nhật ký Audit' })
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @Length(5, 500)
  reason!: string;
}
