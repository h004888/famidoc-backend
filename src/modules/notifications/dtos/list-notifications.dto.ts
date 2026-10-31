import { Type } from 'class-transformer';
import { IsBooleanString, IsInt, Max, Min, ValidateIf } from 'class-validator';
export class ListNotificationsDto {
  @Type(() => Number) @IsInt() @Min(1) page: number = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit: number = 20;
  // Dùng BooleanString để query "false" không bị ép thành true bởi JavaScript.
  @ValidateIf((_o, v) => v !== undefined)
  @IsBooleanString()
  unreadOnly?: string;
}
