import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
  @ApiProperty({
    description: 'ID giao dịch SePay',
    example: 1234567,
  })
  @IsInt()
  @Min(0) // SePay dùng 0 cho bản tin gửi thử. Controller xử lý riêng bản tin này.
  @Max(Number.MAX_SAFE_INTEGER)
  id!: number;

  @ApiProperty({
    description: 'Cổng thanh toán / ngân hàng thụ hưởng (MB, VCB, ACB...)',
    example: 'MBBank',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  gateway!: string;

  @ApiProperty({
    description: 'Thời gian giao dịch theo giờ Việt Nam (YYYY-MM-DD HH:mm:ss)',
    example: '2026-11-10 08:30:00',
  })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  transactionDate!: string; // SePay gửi giờ Việt Nam, không phải UTC.

  @ApiProperty({
    description: 'Số tài khoản ngân hàng thụ hưởng',
    example: '0987654321',
  })
  @IsString()
  @Matches(/^[0-9]{5,34}$/)
  accountNumber!: string;

  @ApiPropertyOptional({
    description: 'Mã code thanh toán nhận diện',
    example: 'FAMIDOC123456',
  })
  @IsOptional() // null có nghĩa không trích được mã; khi đó sẽ thử lấy từ content.
  @IsString()
  @MaxLength(100)
  code?: string | null;

  @ApiProperty({
    description: 'Nội dung chuyển khoản ngân hàng',
    example: 'FAMIDOC TH THANH TOAN HD 123456',
  })
  @IsString()
  @MaxLength(2000)
  content!: string;

  @ApiProperty({
    enum: ['in', 'out'],
    description: 'Loại luân chuyển tiền (in: tiền vào, out: tiền ra)',
    example: 'in',
  })
  @IsIn(['in', 'out'])
  transferType!: 'in' | 'out';

  @ApiProperty({
    description: 'Số tiền giao dịch thực tế (VNĐ)',
    example: 5000000,
  })
  @IsInt()
  @Min(1)
  @Max(9_999_999_999)
  transferAmount!: number;

  @ApiPropertyOptional({
    description: 'Mã tham chiếu ngân hàng',
    example: 'REF123456789',
  })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  referenceCode?: string;

  @ApiPropertyOptional({
    description: 'Tài khoản phụ / tên gợi nhớ',
    example: 'FAMIDOC_PRIMARY',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  subAccount?: string;

  @ApiPropertyOptional({
    description: 'Mô tả chi tiết bổ sung',
    example: 'Giao dịch qua VietQR SePay',
  })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @ApiPropertyOptional({
    description: 'Số dư tài khoản tích lũy sau giao dịch',
    example: 100000000,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  accumulated?: number; // Không dùng số dư tài khoản để xác nhận một lần thanh toán.
}
