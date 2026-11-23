import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';

// Số tiền, mã chuyển khoản, tài khoản nhận và thời hạn đều do backend xác định.
export class CreatePaymentRequestDto {
  @ApiProperty({
    description: 'UUID của hợp đồng y tế cần tạo yêu cầu thanh toán VietQR',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @IsUUID('4', { message: 'ID hợp đồng không đúng định dạng UUID.' })
  contractId!: string;

  @ApiPropertyOptional({
    description: 'UUID của phụ lục hợp đồng (nếu thanh toán cho phụ lục phát sinh)',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @IsOptional()
  @IsUUID('4', { message: 'ID phụ lục không đúng định dạng UUID.' })
  addendumId?: string;
}

export class AdminPaymentRequestDto extends CreatePaymentRequestDto {
  @ApiProperty({ minimum: 1, maximum: 9999999999 })
  @IsInt({ message: 'Số tiền cần thu phải là số nguyên (VNĐ).' })
  @Min(1, { message: 'Số tiền cần thu phải lớn hơn 0 VNĐ.' })
  @Max(9999999999, {
    message: 'Số tiền cần thu không được vượt quá 9.999.999.999 VNĐ.',
  })
  amountVnd!: number;

  @ApiProperty({ description: 'Phần mô tả ngân hàng. Hệ thống thêm mã FD của hóa đơn.' })
  @Transform(({ value }) => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').toUpperCase() : value)
  @IsString({ message: 'Nội dung chuyển khoản phải là chuỗi ký tự.' })
  // VietQR nhận tối đa 94 ký tự, chừa 1 dấu cách và 8 ký tự cho mã FD.
  @Length(1, 85, {
    message: 'Nội dung chuyển khoản phải từ 1 đến 85 ký tự.',
  })
  @Matches(/^[A-Z0-9][A-Z0-9 ]*$/, {
    message:
      'Nội dung chuyển khoản chỉ được dùng chữ cái không dấu (A-Z), số (0-9) và dấu cách.',
  })
  transferDescription!: string;

  @ApiProperty({ description: 'Lý do điều chỉnh để ghi vào nhật ký Audit' })
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString({ message: 'Lý do tạo hoặc đổi mã phải là chuỗi ký tự.' })
  @Length(5, 500, {
    message: 'Lý do tạo hoặc đổi mã phải từ 5 đến 500 ký tự.',
  })
  reason!: string;
}
