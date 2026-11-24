import { IsBoolean, IsISO8601, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ConfirmEncounterDto {
  @ApiProperty({
    description: 'Xác nhận đồng ý với lịch khám đề xuất',
    example: true,
  })
  @IsBoolean()
  @IsNotEmpty()
  confirmed!: boolean;

  @ApiPropertyOptional({
    description: 'Mốc giờ gọi cụ thể Bác sĩ chốt trong khung buổi (HH:mm)',
    example: '09:30',
  })
  @Matches(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/)
  @IsOptional()
  confirmedTime?: string;

  @ApiPropertyOptional({
    description: 'Đề xuất đổi sang khung buổi khác (COUNTER_PROPOSED)',
    enum: ['MORNING', 'AFTERNOON'],
  })
  @IsString()
  @IsOptional()
  proposedSlotWindow?: 'MORNING' | 'AFTERNOON';

  @ApiPropertyOptional({
    description: 'Ngày đề xuất mới khi Bác sĩ đổi buổi (YYYY-MM-DD)',
  })
  @IsISO8601({ strict: true })
  @IsOptional()
  proposedDate?: string;
}
