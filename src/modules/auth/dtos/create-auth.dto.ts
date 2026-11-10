import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class CreateAuthDto {
  @ApiProperty({ example: 'Nguyễn Văn A', description: 'Tên người dùng' })
  @IsString()
  @IsNotEmpty()
  name!: string;
}
