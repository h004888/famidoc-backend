import { IsUUID, IsOptional } from 'class-validator';

// Số tiền, mã chuyển khoản, tài khoản nhận và thời hạn đều do backend xác định.
export class CreatePaymentRequestDto {
  @IsUUID('4')
  contractId: string;

  @IsOptional()
  @IsUUID('4')
  addendumId?: string;
}
