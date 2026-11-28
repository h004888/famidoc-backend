import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PatientAllergySummaryDto {
  @ApiProperty({ example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  id!: string;

  @ApiProperty({ example: 'MEDICATION' })
  allergenType!: string;

  @ApiProperty({ example: 'Amoxicillin' })
  allergenName!: string;

  @ApiProperty({ example: 'HIGH' })
  severity!: string;

  @ApiPropertyOptional({ example: 'Phát ban đỏ toàn thân, khó thở nhẹ' })
  clinicalManifestation?: string | null;
}

export class PatientDocumentSummaryDto {
  @ApiProperty({ example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  id!: string;

  @ApiProperty({ example: 'Sổ tiêm chủng mở rộng' })
  documentName!: string;

  @ApiProperty({ example: 'IMMUNIZATION_RECORD' })
  documentType!: string;

  @ApiProperty({ example: 'https://cdn.famidoc.vn/docs/tiemchung-001.pdf' })
  fileUrl!: string;

  @ApiProperty({ example: 1200 })
  fileSizeKb!: number;

  @ApiProperty({ example: '2025-06-01' })
  recordedDate!: Date;
}

export class PatientChronicConditionSummaryDto {
  @ApiProperty({ example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  id!: string;

  @ApiProperty({ example: 'Tăng huyết áp' })
  conditionName!: string;

  @ApiPropertyOptional({ example: 'I10' })
  icd10Code?: string | null;

  @ApiProperty({ example: 'ACTIVE' })
  clinicalStatus!: string;

  @ApiPropertyOptional({ example: 'Đang uống thuốc đều' })
  notes?: string | null;
}

export class PatientCareSummaryDto {
  @ApiProperty({ example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  patientId!: string;

  @ApiProperty({ example: 'Nguyễn Văn Con' })
  fullName!: string;

  @ApiProperty({ example: '2020-01-15', nullable: true })
  dateOfBirth!: Date | null;

  @ApiProperty({ example: 6, nullable: true })
  age!: number | null;

  @ApiProperty({
    example: 'CHILD',
    description:
      'Nhóm tuổi: CHILD (0-12), ADOLESCENT (13-17), ADULT (18-59), ELDERLY (>=60), UNKNOWN (chưa có ngày sinh)',
  })
  ageGroup!: 'CHILD' | 'ADOLESCENT' | 'ADULT' | 'ELDERLY' | 'UNKNOWN';

  @ApiProperty({ example: 'MALE', nullable: true })
  gender!: string | null;

  @ApiProperty({ example: 'CON' })
  relationshipToHead!: string;

  @ApiPropertyOptional({ example: 168.5 })
  heightCm?: number | null;

  @ApiPropertyOptional({ example: 62.0 })
  weightKg?: number | null;

  @ApiPropertyOptional({ example: 'Tăng huyết áp, Tiểu đường' })
  chronicDiseases?: string | null;

  @ApiProperty({ type: [PatientAllergySummaryDto] })
  allergies!: PatientAllergySummaryDto[];

  @ApiProperty({ type: [PatientChronicConditionSummaryDto] })
  chronicConditions!: PatientChronicConditionSummaryDto[];

  @ApiProperty({ type: [PatientDocumentSummaryDto] })
  documents!: PatientDocumentSummaryDto[];
}

export class CareNeedsSummaryDto {
  @ApiProperty({ example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  contractId!: string;

  @ApiProperty({ example: 'CTR-2026-000001' })
  contractNumber!: string;

  @ApiProperty({ example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  familyId!: string;

  @ApiProperty({ example: 'Gói Chăm Sóc Toàn Diện' })
  packageName!: string;

  @ApiProperty({ example: 2 })
  totalMembers!: number;

  @ApiProperty({ type: [PatientCareSummaryDto] })
  members!: PatientCareSummaryDto[];
}
