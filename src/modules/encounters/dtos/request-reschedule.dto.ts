import { IsISO8601, IsNotEmpty, IsString, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RequestRescheduleDto {
  @ApiProperty({
    description: 'Ngày khám mới mong muốn đề xuất (định dạng YYYY-MM-DD)',
    example: '2026-11-25',
  })
  @IsISO8601({ strict: true })
  @IsNotEmpty()
  proposedDate!: string;

  @ApiProperty({
    description: 'Giờ khám mới mong muốn đề xuất (định dạng HH:mm hoặc HH:mm:ss)',
    example: '10:00:00',
  })
  @Matches(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, {
    message: 'proposedTime must be in HH:mm or HH:mm:ss format',
  })
  @IsNotEmpty()
  proposedTime!: string;

  @ApiProperty({
    description: 'Lý do xin dời lịch khám',
    example: 'Gia đình bận công tác đột xuất vào ngày đã định',
  })
  @IsString()
  @IsNotEmpty()
  rescheduleReason!: string;
}
