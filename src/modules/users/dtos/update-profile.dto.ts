import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsUrl, Length, ValidateIf } from 'class-validator';
import { Transform } from 'class-transformer';

export class UpdateProfileDto {
  @ApiPropertyOptional({
    description: 'Họ và tên hiển thị của người dùng',
    example: 'Nguyễn Văn A',
    maxLength: 100,
  })
  @ValidateIf((_o, v) => v !== undefined)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, 100)
  fullName?: string;

  // Thông tin liên hệ đã xác thực, vai trò và trạng thái không được sửa qua API này.
  @ApiPropertyOptional({
    description: 'Đường dẫn ảnh đại diện (phải bắt đầu bằng https://)',
    example: 'https://storage.famidoc.vn/avatars/user_123.jpg',
    maxLength: 255,
  })
  @ValidateIf((_o, v) => v !== undefined)
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @Length(1, 255)
  avatarUrl?: string;
}
