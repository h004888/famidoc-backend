import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class LogoutDto {
  @ApiPropertyOptional({
    description: 'Refresh token của phiên hiện tại cần thu hồi trong DB',
  })
  @IsOptional()
  @IsString()
  refreshToken?: string;
}
