import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

// Các trường SePay gửi qua webhook. Guard xác thực nguồn trước khi xử lý nội dung.
export class SePayWebhookDto {
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  id: number;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  gateway: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  transactionDate: string; // SePay gửi giờ Việt Nam, không phải UTC.

  @IsString()
  @Matches(/^[0-9]{5,34}$/)
  accountNumber: string;

  @IsOptional() // null có nghĩa không trích được mã; khi đó sẽ thử lấy từ content.
  @IsString()
  @MaxLength(100)
  code?: string | null;

  @IsString()
  @MaxLength(2000)
  content: string;

  @IsIn(['in', 'out'])
  transferType: 'in' | 'out';

  @IsInt()
  @Min(1)
  @Max(9_999_999_999)
  transferAmount: number;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  referenceCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  subAccount?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  accumulated?: number; // Không dùng số dư tài khoản để xác nhận một lần thanh toán.
}
