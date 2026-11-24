import { IsArray, IsEnum, IsISO8601, IsNotEmpty, IsOptional, IsString, IsUUID, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EncounterType, EncounterVisitScope } from '@prisma/client';

export class CreateAdHocEncounterDto {
  @ApiProperty({
    description: 'ID hợp đồng y tế đang hoạt động',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @IsUUID('4')
  @IsNotEmpty()
  contractId!: string;

  @ApiPropertyOptional({
    description: 'ID bệnh nhân cần khám đột xuất',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @IsUUID('4')
  @IsOptional()
  patientId?: string;

  @ApiPropertyOptional({
    description: 'Danh sách ID thành viên gia đình cần khám đột xuất',
    type: [String],
  })
  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  patientIds?: string[];

  @ApiPropertyOptional({
    description: 'Phạm vi buổi khám: FAMILY (cả gia đình) hoặc INDIVIDUAL',
    enum: EncounterVisitScope,
  })
  @IsEnum(EncounterVisitScope)
  @IsOptional()
  visitScope?: EncounterVisitScope;

  @ApiProperty({
    description: 'Hình thức khám mong muốn: Khám tại nhà, Khám từ xa, hoặc Khám tại CSYT',
    enum: EncounterType,
    example: EncounterType.TELEHEALTH,
  })
  @IsEnum(EncounterType)
  @IsNotEmpty()
  encounterType!: EncounterType;

  @ApiProperty({
    description: 'Ngày mong muốn khám (định dạng YYYY-MM-DD)',
    example: '2026-11-20',
  })
  @IsISO8601({ strict: true })
  @IsNotEmpty()
  desiredDate!: string;

  @ApiPropertyOptional({
    description: 'Giờ mong muốn khám (định dạng HH:mm hoặc HH:mm:ss)',
    example: '14:30:00',
  })
  @Matches(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, {
    message: 'desiredTime must be in HH:mm or HH:mm:ss format',
  })
  @IsOptional()
  desiredTime?: string;

  @ApiPropertyOptional({
    description: 'Khung buổi mong muốn: MORNING (Sáng 08:00-11:30) hoặc AFTERNOON (Chiều 13:30-17:30)',
    enum: ['MORNING', 'AFTERNOON'],
  })
  @IsString()
  @IsOptional()
  slotWindow?: 'MORNING' | 'AFTERNOON';

  @ApiPropertyOptional({
    description: 'Chip chủ đề hỏi nhanh 1 chạm',
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  quickTags?: string[];

  @ApiPropertyOptional({
    description: 'Triệu chứng hoặc lý do cần khám đột xuất (tùy chọn)',
    example: 'Bệnh nhân có triệu chứng sốt cao và ho khan 2 ngày nay',
  })
  @IsString()
  @IsOptional()
  reason?: string;
}
