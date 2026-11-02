import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Length } from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty({
    example: 'OldPassword@123',
    description: 'Mật khẩu hiện tại của người dùng',
  })
  @IsString()
  @IsNotEmpty()
  oldPassword!: string;

  @ApiProperty({
    example: 'NewPassword@456',
    description: 'Mật khẩu mới (tối thiểu 8 ký tự, khác mật khẩu cũ)',
  })
  @IsString()
  @Length(8, 64, { message: 'New password must be between 8 and 64 characters' })
  newPassword!: string;
}
