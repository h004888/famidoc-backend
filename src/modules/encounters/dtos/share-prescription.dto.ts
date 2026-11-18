import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  Equals,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Matches,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PatientDocumentType } from '@prisma/client';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

class PrescriptionLineDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  medicationName!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  strength!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  dosage!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  administrationRoute!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  frequency!: string;

  @IsInt()
  @Min(1)
  @Max(100000)
  quantity!: number;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  unit!: string;

  @IsInt()
  @Min(1)
  @Max(365)
  durationDays!: number;
}

class PrescriptionExamDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  chiefComplaint!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  clinicalFindings!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(10)
  icd10Code!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  icd10Diagnosis!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  treatmentPlan!: string;
}

export class PrescriptionInputDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @IsObject({ each: true })
  @ValidateNested({ each: true })
  @Type(() => PrescriptionLineDto)
  details!: PrescriptionLineDto[];

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  instructions?: string;

  @IsUUID()
  recipientUserId!: string;

  @Equals(true, { message: 'Cần xác nhận người nhận có quyền nhận đơn thuốc.' })
  recipientAuthorized!: true;
}

export class SharePrescriptionDto extends PrescriptionInputDto {
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => PrescriptionExamDto)
  exam?: PrescriptionExamDto;
}

export class ConfirmVisitRecordDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Thành viên đang mở trên sổ khám',
  })
  @IsUUID()
  patientId!: string;

  @ApiProperty({
    example: true,
    description: 'Bác sĩ đã kiểm tra và xác nhận nội dung',
  })
  @Equals(true)
  confirmed!: true;

  @ApiPropertyOptional({ type: PrescriptionExamDto })
  @ValidateIf((_object, value) => value !== undefined)
  @IsObject()
  @ValidateNested()
  @Type(() => PrescriptionExamDto)
  exam?: PrescriptionExamDto;

  @ApiPropertyOptional({ type: PrescriptionInputDto })
  @ValidateIf((_object, value) => value !== undefined)
  @IsObject()
  @ValidateNested()
  @Type(() => PrescriptionInputDto)
  prescription?: PrescriptionInputDto;
}

export class PrescriptionPageQuery {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  page = 1;
}

export class FamilyPrescriptionQuery extends PrescriptionPageQuery {
  @IsOptional()
  @IsUUID()
  patientId?: string;
}

export class UploadBookDocumentDto {
  @ApiProperty({ maxLength: 200 })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  documentName!: string;

  @ApiProperty({ enum: PatientDocumentType })
  @IsEnum(PatientDocumentType)
  documentType!: PatientDocumentType;

  @ApiProperty({ example: '2026-11-18' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  recordedDate!: string;
}
