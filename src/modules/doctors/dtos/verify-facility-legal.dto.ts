import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class VerifyFacilityLegalDto {
  @ApiProperty({
    description: 'Kết quả thẩm định pháp lý Cấp 2 (true: Duyệt kích hoạt đối tác, false: Từ chối)',
    example: true,
  })
  @IsNotEmpty({ message: 'approved không được để trống' })
  @IsBoolean({ message: 'approved phải là giá trị boolean' })
  approved!: boolean;

  @ApiPropertyOptional({
    description: 'Lý do từ chối nếu không thông qua thẩm định pháp lý',
    example: 'Số giấy phép hoạt động không trùng khớp với dữ liệu đăng ký của Bộ Y tế.',
  })
  @IsOptional()
  @IsString()
  rejectionReason?: string;
}
