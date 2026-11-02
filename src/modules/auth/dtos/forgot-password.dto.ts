import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty } from 'class-validator';

export class ForgotPasswordDto {
  @ApiProperty({
    example: 'representative@famidoc.vn',
    description: 'Email tài khoản cần khôi phục mật khẩu',
  })
  @IsEmail()
  @IsNotEmpty()
  email!: string;
}
