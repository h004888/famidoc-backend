import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, Length, Matches } from 'class-validator';

export class ResetPasswordDto {
  @ApiProperty({
    example: 'representative@famidoc.vn',
    description: 'Email tài khoản cần đặt lại mật khẩu',
  })
  @IsEmail({}, { message: 'Email must be a valid email address' })
  @IsNotEmpty()
  email!: string;

  @ApiProperty({
    example: '123456',
    description: 'Mã xác thực OTP gồm 6 chữ số nhận qua email',
  })
  @IsString()
  @IsNotEmpty()
  @Length(6, 6, { message: 'OTP must be exactly 6 digits' })
  @Matches(/^[0-9]{6}$/, { message: 'OTP must contain only numbers' })
  otp!: string;

  @ApiProperty({
    example: 'NewPassword@123',
    description: 'Mật khẩu mới (từ 8 đến 64 ký tự)',
  })
  @IsString()
  @Length(8, 64, { message: 'Password must be between 8 and 64 characters' })
  newPassword!: string;
}
