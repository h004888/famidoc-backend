import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class FacilityVerifyCredentialsDto {
  @ApiProperty({
    description: 'Kết quả thẩm định cấp 1 của CSYT (true: Duyệt, false: Từ chối)',
    example: true,
  })
  @IsNotEmpty()
  @IsBoolean()
  approved!: boolean;

  @ApiPropertyOptional({
    description: 'Lý do từ chối nếu không thông qua thẩm định cấp 1',
    example: 'Văn bằng chứng chỉ mờ, không rõ dấu đỏ của Sở Y tế.',
  })
  @IsOptional()
  @IsString()
  rejectionReason?: string;

  @ApiPropertyOptional({
    description: 'Ghi chú thẩm định hồ sơ của CSYT',
    example: 'Đã đối chiếu văn bằng gốc tại đơn vị.',
  })
  @IsOptional()
  @IsString()
  verificationNotes?: string;
}

export class PlatformApproveCredentialsDto {
  @ApiProperty({
    description:
      'Kết quả phê duyệt cấp 2 của Quản trị viên Nền tảng (true: Duyệt kích hoạt, false: Từ chối)',
    example: true,
  })
  @IsNotEmpty()
  @IsBoolean()
  approved!: boolean;

  @ApiPropertyOptional({
    description: 'Lý do từ chối nếu không thông qua phê duyệt cấp 2',
    example: 'Số hiệu CCHN không khớp với Cơ sở dữ liệu Quốc gia ngành Y tế.',
  })
  @IsOptional()
  @IsString()
  rejectionReason?: string;

  @ApiPropertyOptional({
    description: 'Đồng thuận kiểm tra lý lịch / tư pháp ngành y tế',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  backgroundCheckConsent?: boolean;
}

export class ReviewDoctorCredentialsDto {
  @ApiProperty({
    description: 'Cấp thẩm định (1: CSYT thẩm định cấp 1, 2: Quản trị viên phê duyệt cấp 2)',
    example: 1,
    enum: [1, 2],
  })
  @IsNotEmpty()
  tier!: number;

  @ApiPropertyOptional({
    description: 'Kết quả thẩm định (true: Duyệt, false: Từ chối)',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  approved?: boolean;

  @ApiPropertyOptional({
    description: 'Lý do từ chối nếu không thông qua thẩm định',
    example: 'Văn bằng chứng chỉ mờ, không rõ dấu đỏ của Sở Y tế.',
  })
  @IsOptional()
  @IsString()
  rejectionReason?: string;

  @ApiPropertyOptional({
    description: 'Ghi chú thẩm định hồ sơ của CSYT (dành cho Tier 1)',
    example: 'Đã đối chiếu văn bằng gốc tại đơn vị.',
  })
  @IsOptional()
  @IsString()
  verificationNotes?: string;

  @ApiPropertyOptional({
    description: 'Đồng thuận kiểm tra lý lịch / tư pháp ngành y tế (dành cho Tier 2)',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  backgroundCheckConsent?: boolean;
}
