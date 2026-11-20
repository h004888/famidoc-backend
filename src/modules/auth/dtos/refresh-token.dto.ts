import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class RefreshTokenDto {
  @ApiProperty({
    description: 'Refresh token dùng để cấp mới cặp accessToken & refreshToken',
    example: 'rft_9k2mP8...',
  })
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;
}
