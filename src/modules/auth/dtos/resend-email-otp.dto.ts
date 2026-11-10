import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty } from 'class-validator';

export class ResendEmailOtpDto {
  @ApiProperty({
    example: 'representative@famidoc.vn',
    description: 'Địa chỉ email cần nhận lại mã OTP',
  })
  @IsEmail()
  @IsNotEmpty()
  email!: string;
}
