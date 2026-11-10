import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBooleanString, IsInt, Max, Min, ValidateIf } from 'class-validator';

export class ListNotificationsDto {
  @ApiPropertyOptional({
    description: 'Số trang cần lấy (bắt đầu từ 1)',
    example: 1,
    default: 1,
    minimum: 1,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({
    description: 'Số lượng thông báo trên mỗi trang (tối đa 100)',
    example: 20,
    default: 20,
    minimum: 1,
    maximum: 100,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  // Dùng BooleanString để query "false" không bị ép thành true bởi JavaScript.
  @ApiPropertyOptional({
    description: 'Chỉ lọc các thông báo chưa đọc (true / false)',
    example: 'true',
  })
  @ValidateIf((_o, v) => v !== undefined)
  @IsBooleanString()
  unreadOnly?: string;
}
