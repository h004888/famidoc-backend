import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class LoginDto {
  @ApiProperty({
    example: 'linhnyhe187172@fpt.edu.vn',
    description: 'Địa chỉ email đăng nhập',
  })
  @IsEmail({}, { message: 'Email không đúng định dạng' })
  @IsNotEmpty({ message: 'Email không được để trống' })
  email!: string;

  @ApiProperty({
    example: 'Password@123',
    description: 'Mật khẩu tài khoản (tối thiểu 8 ký tự)',
  })
  @IsString()
  @IsNotEmpty({ message: 'Mật khẩu không được để trống' })
  password!: string;

  @ApiPropertyOptional({
    example: true,
    description: 'Ghi nhớ đăng nhập (true: 7 ngày, false: session 1 giờ)',
  })
  @IsOptional()
  @IsBoolean()
  rememberMe?: boolean;
}
