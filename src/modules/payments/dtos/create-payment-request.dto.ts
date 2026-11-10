import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsUUID, IsOptional } from 'class-validator';

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
