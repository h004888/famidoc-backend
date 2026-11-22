import { IsDateString, IsEnum, IsOptional, IsString, Matches } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { EncounterType } from '@prisma/client';

export class AdjustCadenceMilestoneDto {
  @ApiPropertyOptional({ example: '2026-06-15', description: 'Ngày khám định kỳ điều chỉnh (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  scheduledDate?: string;

  @ApiPropertyOptional({ example: '09:30:00', description: 'Giờ khám định kỳ điều chỉnh (HH:mm:ss)' })
  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, {
    message: 'scheduledTime must be in HH:mm or HH:mm:ss format',
  })
  scheduledTime?: string;

  @ApiPropertyOptional({ enum: EncounterType, description: 'Hình thức khám' })
  @IsOptional()
  @IsEnum(EncounterType)
  encounterType?: EncounterType;
}
