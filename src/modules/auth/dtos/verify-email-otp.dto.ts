import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, Length, Matches } from 'class-validator';

export class VerifyEmailOtpDto {
  @ApiProperty({
    example: 'representative@famidoc.vn',
    description: 'Địa chỉ email đã đăng ký tài khoản cần xác thực',
  })
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @ApiProperty({
    example: '123456',
    description: 'Mã OTP 6 chữ số nhận qua email',
  })
  @IsString()
  @IsNotEmpty()
  @Length(6, 6, { message: 'OTP must be exactly 6 digits' })
  @Matches(/^[0-9]{6}$/, { message: 'OTP must be numeric' })
  otp!: string;
}
