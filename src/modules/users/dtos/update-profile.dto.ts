import { IsString, IsUrl, Length, ValidateIf } from 'class-validator';
import { Transform } from 'class-transformer';
export class UpdateProfileDto {
  @ValidateIf((_o, v) => v !== undefined)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, 100)
  fullName?: string;

  // Thông tin liên hệ đã xác thực, vai trò và trạng thái không được sửa qua API này.
  @ValidateIf((_o, v) => v !== undefined)
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @Length(1, 255)
  avatarUrl?: string;
}
