import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';

export class RegisterFamilyRepDto {
  @ApiProperty({
    example: 'Nguyễn Văn Đại Diện',
    description: 'Họ và tên người đại diện gia đình',
  })
  @IsString()
  @IsNotEmpty()
  fullName!: string;

  @ApiProperty({
    example: '0912345678',
    description: 'Số điện thoại liên hệ (10-11 chữ số)',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[0-9]{10,11}$/, {
    message: 'Phone must be a valid 10-11 digit phone number',
  })
  phone!: string;

  @ApiProperty({
    example: 'representative@famidoc.vn',
    description: 'Địa chỉ email đăng ký nhận OTP',
  })
  @IsEmail({}, { message: 'Email must be a valid email address' })
  @IsNotEmpty()
  email!: string;

  @ApiProperty({
    example: 'Password@123',
    description: 'Mật khẩu tài khoản (8 - 64 ký tự)',
  })
  @IsString()
  @Length(8, 64, { message: 'Password must be between 8 and 64 characters' })
  password!: string;

  @ApiProperty({
    example: true,
    description: 'Đồng ý với điều khoản sử dụng và chính sách bảo mật',
  })
  @IsBoolean()
  acceptedTerms!: boolean;

  @ApiPropertyOptional({
    example: '123 Đường Nguyễn Huệ, Quận 1, TP. Hồ Chí Minh',
    description: 'Địa chỉ cư trú của gia đình',
  })
  @IsOptional()
  @IsString()
  homeAddress?: string;
}
