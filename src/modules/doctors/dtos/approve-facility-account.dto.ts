import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ApproveFacilityAccountDto {
  @ApiProperty({
    description: 'Kết quả duyệt cấp tài khoản ban đầu (true: Duyệt cấp tài khoản, false: Từ chối)',
    example: true,
  })
  @IsNotEmpty({ message: 'approved không được để trống' })
  @IsBoolean({ message: 'approved phải là giá trị boolean' })
  approved!: boolean;

  @ApiPropertyOptional({
    description: 'Lý do từ chối nếu không duyệt cấp tài khoản',
    example: 'Thông tin cơ sở y tế không có thật hoặc địa chỉ không chính xác.',
  })
  @IsOptional()
  @IsString()
  rejectionReason?: string;
}
