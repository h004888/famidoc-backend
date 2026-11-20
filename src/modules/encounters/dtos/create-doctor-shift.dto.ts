import { IsISO8601, IsNotEmpty, IsOptional, IsString, IsUUID, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateDoctorShiftDto {
  @ApiProperty({
    description: 'ID bác sĩ được phân ca',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @IsUUID('4')
  @IsNotEmpty()
  doctorId!: string;

  @ApiProperty({
    description: 'Ngày trực (định dạng YYYY-MM-DD)',
    example: '2026-11-20',
  })
  @IsISO8601({ strict: true })
  @IsNotEmpty()
  shiftDate!: string;

  @ApiProperty({
    description: 'Giờ bắt đầu ca trực (định dạng HH:mm hoặc HH:mm:ss)',
    example: '07:30:00',
  })
  @Matches(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, {
    message: 'startTime must be in HH:mm or HH:mm:ss format',
  })
  @IsNotEmpty()
  startTime!: string;

  @ApiProperty({
    description: 'Giờ kết thúc ca trực (định dạng HH:mm hoặc HH:mm:ss)',
    example: '11:30:00',
  })
  @Matches(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, {
    message: 'endTime must be in HH:mm or HH:mm:ss format',
  })
  @IsNotEmpty()
  endTime!: string;

  @ApiProperty({
    description: 'Loại ca trực (ví dụ: MORNING_CLINIC, AFTERNOON_CLINIC, NIGHT_DUTY, EMERGENCY)',
    example: 'MORNING_CLINIC',
  })
  @IsString()
  @IsNotEmpty()
  shiftType!: string;

  @ApiPropertyOptional({
    description: 'Ghi chú phân công ca trực',
    example: 'Phụ trách phòng khám Đa khoa tầng 2',
  })
  @IsString()
  @IsOptional()
  notes?: string;
}
