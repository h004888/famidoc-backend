import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class LoginDto {
  @ApiProperty({
    example: 'representative@famidoc.vn',
    description: 'Email hoặc Số điện thoại đăng nhập của người dùng',
  })
  @IsString()
  @IsNotEmpty()
  identifier!: string;

  @ApiProperty({
    example: 'Password@123',
    description: 'Mật khẩu tài khoản (tối thiểu 8 ký tự)',
  })
  @IsString()
  @IsNotEmpty()
  password!: string;
}
