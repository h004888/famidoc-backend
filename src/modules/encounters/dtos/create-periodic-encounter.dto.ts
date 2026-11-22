import { IsArray, IsEnum, IsISO8601, IsNotEmpty, IsOptional, IsString, IsUUID, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EncounterType, EncounterVisitScope } from '@prisma/client';

export class CreatePeriodicEncounterDto {
  @ApiProperty({
    description: 'ID hợp đồng y tế đang hoạt động',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @IsUUID('4')
  @IsNotEmpty()
  contractId!: string;

  @ApiPropertyOptional({
    description: 'ID thành viên gia đình (bệnh nhân) được khám (tùy chọn nếu khám cả gia đình)',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @IsUUID('4')
  @IsOptional()
  patientId?: string;

  @ApiPropertyOptional({
    description: 'Danh sách ID thành viên gia đình tham gia buổi khám',
    type: [String],
  })
  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  patientIds?: string[];

  @ApiPropertyOptional({
    description: 'Phạm vi buổi khám: cả gia đình (FAMILY) hoặc cá nhân (INDIVIDUAL)',
    enum: EncounterVisitScope,
  })
  @IsEnum(EncounterVisitScope)
  @IsOptional()
  visitScope?: EncounterVisitScope;

  @ApiProperty({
    description: 'Hình thức khám bệnh: Khám tại nhà, Khám từ xa, hoặc Khám tại CSYT',
    enum: EncounterType,
    example: EncounterType.HOME_VISIT,
  })
  @IsEnum(EncounterType)
  @IsNotEmpty()
  encounterType!: EncounterType;

  @ApiProperty({
    description: 'Ngày khám dự kiến (định dạng YYYY-MM-DD)',
    example: '2026-12-01',
  })
  @IsISO8601({ strict: true })
  @IsNotEmpty()
  scheduledDate!: string;

  @ApiProperty({
    description: 'Giờ khám dự kiến (định dạng HH:mm:ss hoặc HH:mm)',
    example: '09:00:00',
  })
  @Matches(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, {
    message: 'scheduledTime must be in HH:mm or HH:mm:ss format',
  })
  @IsNotEmpty()
  scheduledTime!: string;

  @ApiPropertyOptional({
    description: 'Ghi chú hoặc kế hoạch khám định kỳ từ bác sĩ',
    example: 'Khám sức khỏe tổng quát định kỳ quý 4 cho người cao tuổi',
  })
  @IsString()
  @IsOptional()
  notes?: string;
}
