import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty } from 'class-validator';

export class ForgotPasswordDto {
  @ApiProperty({
    example: 'linhnyhe187172@fpt.edu.vn',
    description: 'Email tài khoản cần khôi phục mật khẩu',
  })
  @IsEmail()
  @IsNotEmpty()
  email!: string;
}
