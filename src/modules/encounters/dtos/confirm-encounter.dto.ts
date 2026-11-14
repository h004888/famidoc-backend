import { IsBoolean, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ConfirmEncounterDto {
  @ApiProperty({
    description: 'Xác nhận đồng ý với lịch khám đề xuất',
    example: true,
  })
  @IsBoolean()
  @IsNotEmpty()
  confirmed!: boolean;
}
