import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CompleteEncounterDto {
  @ApiPropertyOptional({
    description: 'Lý do nộp hồ sơ trễ (bắt buộc khi quá 23:59 ngày khám)',
    example: 'Bác sĩ mất kết nối mạng khi thăm khám tại nhà vùng ngoại thành',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'Lý do nộp hồ sơ trễ phải là chuỗi ký tự.' })
  @MaxLength(2000, {
    message: 'Lý do nộp hồ sơ trễ không được vượt quá 2000 ký tự.',
  })
  lateCompletionReason?: string;
}
