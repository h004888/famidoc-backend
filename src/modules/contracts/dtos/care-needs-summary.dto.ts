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

export class PatientCareSummaryDto {
  @ApiProperty({ example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  patientId!: string;

  @ApiProperty({ example: 'Nguyễn Văn Con' })
  fullName!: string;

  @ApiProperty({ example: '2020-01-15' })
  dateOfBirth!: Date;

  @ApiProperty({ example: 6 })
  age!: number;

  @ApiProperty({
    example: 'CHILD',
    description:
      'Nhóm tuổi: CHILD (0-12), ADOLESCENT (13-17), ADULT (18-59), ELDERLY (>=60)',
  })
  ageGroup!: 'CHILD' | 'ADOLESCENT' | 'ADULT' | 'ELDERLY';

  @ApiProperty({ example: 'MALE' })
  gender!: string;

  @ApiProperty({ example: 'CON' })
  relationshipToHead!: string;

  @ApiPropertyOptional({ example: '001200000001' })
  citizenId?: string | null;

  @ApiPropertyOptional({ example: 'DN4010123456789' })
  healthInsuranceNumber?: string | null;

  @ApiProperty({ type: [PatientAllergySummaryDto] })
  allergies!: PatientAllergySummaryDto[];

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
