import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class LoginDto {
  @ApiPropertyOptional({
    example: 'linhnyhe187172@fpt.edu.vn',
    description: 'Email hoặc Số điện thoại đăng nhập của người dùng',
  })
  @IsOptional()
  @IsString()
  identifier?: string;

  @ApiPropertyOptional({
    example: 'linhnyhe187172@fpt.edu.vn',
    description: 'Địa chỉ email đăng nhập (alias của identifier)',
  })
  @IsOptional()
  @IsString()
  email?: string;

  @ApiPropertyOptional({
    example: '0988776655',
    description: 'Số điện thoại đăng nhập (alias của identifier)',
  })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiProperty({
    example: 'Password@123',
    description: 'Mật khẩu tài khoản (tối thiểu 8 ký tự)',
  })
  @IsString()
  @IsNotEmpty()
  password!: string;
}
