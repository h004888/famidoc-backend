import { IsEnum, IsISO8601, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { EncounterCategory, EncounterStatus, EncounterType } from '@prisma/client';
import { PaginationQueryDto } from '../../../core/dtos/pagination-query.dto';

export class ListEncountersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Lọc theo trạng thái lịch khám',
    enum: EncounterStatus,
  })
  @IsEnum(EncounterStatus)
  @IsOptional()
  status?: EncounterStatus;

  @ApiPropertyOptional({
    description: 'Lọc theo phân loại khám (PERIODIC_ROUTINE hoặc AD_HOC_ON_DEMAND)',
    enum: EncounterCategory,
  })
  @IsEnum(EncounterCategory)
  @IsOptional()
  category?: EncounterCategory;

  @ApiPropertyOptional({
    description: 'Lọc theo hình thức khám',
    enum: EncounterType,
  })
  @IsEnum(EncounterType)
  @IsOptional()
  encounterType?: EncounterType;

  @ApiPropertyOptional({
    description: 'Lọc từ ngày (định dạng YYYY-MM-DD)',
    example: '2026-11-01',
  })
  @IsISO8601({ strict: true })
  @IsOptional()
  fromDate?: string;

  @ApiPropertyOptional({
    description: 'Lọc đến ngày (định dạng YYYY-MM-DD)',
    example: '2026-11-30',
  })
  @IsISO8601({ strict: true })
  @IsOptional()
  toDate?: string;
}
