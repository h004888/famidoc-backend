import { IsEnum, IsISO8601, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { EncounterType } from '@prisma/client';

export class FinalizeEncounterDto {
  @ApiPropertyOptional({
    description: 'Điều chỉnh hình thức khám nếu cần thiết',
    enum: EncounterType,
    example: EncounterType.HOME_VISIT,
  })
  @IsEnum(EncounterType)
  @IsOptional()
  encounterType?: EncounterType;

  @ApiPropertyOptional({
    description: 'Ngày khám được bác sĩ chốt (định dạng YYYY-MM-DD)',
    example: '2026-11-21',
  })
  @IsISO8601({ strict: true })
  @IsOptional()
  scheduledDate?: string;

  @ApiPropertyOptional({
    description: 'Giờ khám được bác sĩ chốt (định dạng HH:mm hoặc HH:mm:ss)',
    example: '15:00:00',
  })
  @Matches(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, {
    message: 'scheduledTime must be in HH:mm or HH:mm:ss format',
  })
  @IsOptional()
  scheduledTime?: string;

  @ApiPropertyOptional({
    description: 'Ghi chú hoặc lời dặn của bác sĩ gửi kèm gia đình',
    example: 'Đã xếp lịch khám tại nhà, đề nghị gia đình chuẩn bị sẵn sổ theo dõi huyết áp.',
  })
  @IsString()
  @IsOptional()
  doctorNotes?: string;
}
