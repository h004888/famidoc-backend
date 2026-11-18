import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { hasAnyVitalMetric } from '../utils/vital-sign.util';

export class CreateVitalSignDto {
  @ApiPropertyOptional({ description: 'Huyết áp tâm thu (mmHg)', example: 120 })
  @ValidateIf(
    (o: CreateVitalSignDto) =>
      o.systolicBp !== undefined || !hasAnyVitalMetric(o),
  )
  @IsNotEmpty({ message: 'Vui lòng nhập ít nhất một chỉ số sinh tồn' })
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
    description: 'Thời điểm đo (ISO-8601), mặc định thời điểm hiện tại',
    example: '2026-11-18T07:30:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  recordedAt?: string;
}
