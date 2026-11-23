import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  GLUCOSE_CONTEXT_VALUES,
  MEASUREMENT_STATE_VALUES,
} from './create-vital-sign.dto';

export class UpdateVitalSignDto {
  @ApiPropertyOptional({ description: 'Huyết áp tâm thu (mmHg)', example: 120 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(40)
  @Max(300)
  systolicBp?: number;

  @ApiPropertyOptional({ description: 'Huyết áp tâm trương (mmHg)', example: 80 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(30)
  @Max(200)
  diastolicBp?: number;

  @ApiPropertyOptional({ description: 'Nhịp tim (lần/phút)', example: 74 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(25)
  @Max(250)
  heartRate?: number;

  @ApiPropertyOptional({ description: 'Nhiệt độ cơ thể (°C)', example: 36.7 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(30)
  @Max(45)
  temperature?: number;

  @ApiPropertyOptional({ description: 'Độ bão hòa oxy máu SpO2 (%)', example: 98 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(50)
  @Max(100)
  spo2?: number;

  @ApiPropertyOptional({ description: 'Nhịp thở (lần/phút)', example: 18 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(60)
  respiratoryRate?: number;

  @ApiPropertyOptional({ description: 'Đường huyết (mmol/L)', example: 5.6 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(40)
  bloodGlucose?: number;

  @ApiPropertyOptional({
    description: 'Bối cảnh đo đường huyết',
    enum: GLUCOSE_CONTEXT_VALUES,
  })
  @IsOptional()
  @IsIn(GLUCOSE_CONTEXT_VALUES)
  glucoseContext?: (typeof GLUCOSE_CONTEXT_VALUES)[number] | null;

  @ApiPropertyOptional({
    description: 'Trạng thái cơ thể khi đo',
    enum: MEASUREMENT_STATE_VALUES,
  })
  @IsOptional()
  @IsIn(MEASUREMENT_STATE_VALUES)
  measurementState?: (typeof MEASUREMENT_STATE_VALUES)[number] | null;

  @ApiPropertyOptional({
    description: 'Ghi chú triệu chứng hoặc hoàn cảnh đo',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string | null;

  @ApiPropertyOptional({
    description: 'Thời điểm đo (ISO-8601)',
    example: '2026-11-18T07:30:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  recordedAt?: string;
}
