import { IsBoolean, IsISO8601, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class DoctorRescheduleReviewDto {
  @ApiProperty({
    description: 'Bác sĩ chấp thuận (true) hoặc từ chối đề xuất của gia đình (false)',
    example: true,
  })
  @IsBoolean()
  @IsNotEmpty()
  accept!: boolean;

  @ApiPropertyOptional({
    description: 'Ngày thay thế bác sĩ đề xuất ngược lại cho gia đình (nếu từ chối nhưng có slot khác)',
    example: '2026-11-26',
  })
  @IsISO8601({ strict: true })
  @IsOptional()
  counterDate?: string;

  @ApiPropertyOptional({
    description: 'Giờ thay thế bác sĩ đề xuất ngược lại cho gia đình (định dạng HH:mm hoặc HH:mm:ss)',
    example: '14:00:00',
  })
  @Matches(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, {
    message: 'counterTime must be in HH:mm or HH:mm:ss format',
  })
  @IsOptional()
  counterTime?: string;

  @ApiPropertyOptional({
    description: 'Lý do từ chối hoặc ghi chú khung giờ thay thế',
    example: 'Khung giờ gia đình chọn tôi bị vướng ca trực tại bệnh viện, xin đề xuất chuyển sang chiều 26/11.',
  })
  @IsString()
  @IsOptional()
  notes?: string;
}
