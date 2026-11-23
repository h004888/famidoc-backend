import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  Equals,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Matches,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PatientDocumentType } from '@prisma/client';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

class PrescriptionLineDto {
  @IsOptional()
  @IsEnum(
    {
      SINGLE_INGREDIENT: 'SINGLE_INGREDIENT',
      COMBINATION: 'COMBINATION',
      BIOLOGICAL: 'BIOLOGICAL',
    },
    {
      message:
        'Mẫu này chỉ hỗ trợ thuốc thường: một hoạt chất, phối hợp hoặc sinh phẩm.',
    },
  )
  medicationType?: 'SINGLE_INGREDIENT' | 'COMBINATION' | 'BIOLOGICAL';
  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'Mã thuốc phải là chuỗi ký tự.' })
  @MaxLength(100, { message: 'Mã thuốc không được vượt quá 100 ký tự.' })
  medicationCode?: string;

  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'Hoạt chất phải là chuỗi ký tự.' })
  @MaxLength(255, { message: 'Hoạt chất không được vượt quá 255 ký tự.' })
  activeIngredient?: string;

  @Transform(trim)
  @IsString({ message: 'Tên thuốc phải là chuỗi ký tự.' })
  @IsNotEmpty({ message: 'Vui lòng nhập tên thuốc.' })
  @MaxLength(150, { message: 'Tên thuốc không được vượt quá 150 ký tự.' })
  medicationName!: string;

  @Transform(trim)
  @IsString({ message: 'Hàm lượng phải là chuỗi ký tự.' })
  @IsNotEmpty({ message: 'Vui lòng nhập hàm lượng / nồng độ thuốc.' })
  @MaxLength(50, { message: 'Hàm lượng không được vượt quá 50 ký tự.' })
  strength!: string;

  @Transform(trim)
  @IsString({ message: 'Liều mỗi lần phải là chuỗi ký tự.' })
  @IsNotEmpty({ message: 'Vui lòng nhập liều dùng mỗi lần.' })
  @MaxLength(50, { message: 'Liều mỗi lần không được vượt quá 50 ký tự.' })
  dosage!: string;

  @Transform(trim)
  @IsString({ message: 'Đường dùng phải là chuỗi ký tự.' })
  @IsNotEmpty({ message: 'Vui lòng nhập đường dùng thuốc.' })
  @MaxLength(50, { message: 'Đường dùng không được vượt quá 50 ký tự.' })
  administrationRoute!: string;

  @Transform(trim)
  @IsString({ message: 'Tần suất dùng phải là chuỗi ký tự.' })
  @IsNotEmpty({ message: 'Vui lòng nhập tần suất và thời điểm dùng.' })
  @MaxLength(100, { message: 'Tần suất dùng không được vượt quá 100 ký tự.' })
  frequency!: string;

  @IsInt({ message: 'Tổng số lượng thuốc phải là số nguyên.' })
  @Min(1, { message: 'Tổng số lượng thuốc phải lớn hơn hoặc bằng 1.' })
  @Max(100000, { message: 'Tổng số lượng thuốc không được vượt quá 100.000.' })
  quantity!: number;

  @Transform(trim)
  @IsString({ message: 'Đơn vị tính phải là chuỗi ký tự.' })
  @IsNotEmpty({ message: 'Vui lòng nhập đơn vị tính của thuốc.' })
  @MaxLength(30, { message: 'Đơn vị tính không được vượt quá 30 ký tự.' })
  unit!: string;

  @IsInt({ message: 'Số ngày dùng thuốc phải là số nguyên.' })
  @Min(1, { message: 'Số ngày dùng thuốc phải từ 1 đến 90 ngày.' })
  @Max(90, { message: 'Số ngày dùng thuốc không được vượt quá 90 ngày.' })
  durationDays!: number;
}

class PrescriptionExamDto {
  @Transform(trim)
  @IsString({ message: 'Lý do khám phải là chuỗi ký tự.' })
  @IsNotEmpty({ message: 'Vui lòng nhập lý do khám.' })
  @MaxLength(4000, { message: 'Lý do khám không được vượt quá 4000 ký tự.' })
  chiefComplaint!: string;

  @Transform(trim)
  @IsString({ message: 'Kết quả thăm khám phải là chuỗi ký tự.' })
  @IsNotEmpty({ message: 'Vui lòng nhập kết quả thăm khám.' })
  @MaxLength(4000, {
    message: 'Kết quả thăm khám không được vượt quá 4000 ký tự.',
  })
  clinicalFindings!: string;

  @Transform(trim)
  @IsString({ message: 'Mã ICD-10 phải là chuỗi ký tự.' })
  @IsNotEmpty({ message: 'Vui lòng nhập mã bệnh ICD-10.' })
  @MaxLength(10, { message: 'Mã ICD-10 không được vượt quá 10 ký tự.' })
  icd10Code!: string;

  @Transform(trim)
  @IsString({ message: 'Chẩn đoán phải là chuỗi ký tự.' })
  @IsNotEmpty({ message: 'Vui lòng nhập chẩn đoán.' })
  @MaxLength(255, { message: 'Chẩn đoán không được vượt quá 255 ký tự.' })
  icd10Diagnosis!: string;

  @Transform(trim)
  @IsString({ message: 'Kế hoạch điều trị phải là chuỗi ký tự.' })
  @IsNotEmpty({ message: 'Vui lòng nhập kế hoạch điều trị.' })
  @MaxLength(4000, {
    message: 'Kế hoạch điều trị không được vượt quá 4000 ký tự.',
  })
  treatmentPlan!: string;
}

class PrescriptionContextDto {
  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'Lý do kê dài ngày phải là chuỗi ký tự.' })
  @MinLength(10, { message: 'Lý do kê dài ngày phải có ít nhất 10 ký tự.' })
  @MaxLength(2000, {
    message: 'Lý do kê dài ngày không được vượt quá 2000 ký tự.',
  })
  longTermReason?: string;

  @IsOptional()
  @IsInt({ message: 'Số tháng tuổi phải là số nguyên.' })
  @Min(0, { message: 'Số tháng tuổi không được âm.' })
  @Max(1800, { message: 'Số tháng tuổi không hợp lệ.' })
  ageMonths?: number;
  @IsOptional()
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'Cân nặng phải là số (tối đa 2 chữ số thập phân).' },
  )
  @Min(0.1, { message: 'Cân nặng phải từ 0.1 đến 500 kg.' })
  @Max(500, { message: 'Cân nặng phải từ 0.1 đến 500 kg.' })
  weightKg?: number;

  @IsOptional()
  @IsString({ message: 'Mã định danh công dân phải là chuỗi ký tự.' })
  @Matches(/^\d{12}$/, {
    message: 'Mã định danh công dân phải gồm đúng 12 chữ số.',
  })
  citizenId?: string;

  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'Số CMT/CCCD hoặc hộ chiếu phải là chuỗi ký tự.' })
  @MaxLength(30, {
    message: 'Số CMT/CCCD hoặc hộ chiếu không được vượt quá 30 ký tự.',
  })
  identityDocument?: string;

  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'Mã số BHYT phải là chuỗi ký tự.' })
  @MaxLength(30, { message: 'Mã số BHYT không được vượt quá 30 ký tự.' })
  insuranceNumber?: string;

  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'Dân tộc phải là chuỗi ký tự.' })
  @MaxLength(50, { message: 'Dân tộc không được vượt quá 50 ký tự.' })
  ethnicity?: string;

  @IsOptional()
  @IsString({ message: 'Số điện thoại phải là chuỗi ký tự.' })
  @Matches(/^\+?[0-9]{9,15}$/, {
    message: 'Số điện thoại phải gồm từ 9 đến 15 chữ số.',
  })
  phone?: string;

  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'Địa chỉ liên hệ phải là chuỗi ký tự.' })
  @MaxLength(500, { message: 'Địa chỉ liên hệ không được vượt quá 500 ký tự.' })
  address?: string;

  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'Kết luận phải là chuỗi ký tự.' })
  @MaxLength(2000, { message: 'Kết luận không được vượt quá 2000 ký tự.' })
  conclusion?: string;

  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'Lưu ý phải là chuỗi ký tự.' })
  @MaxLength(2000, { message: 'Lưu ý không được vượt quá 2000 ký tự.' })
  precautions?: string;

  @IsOptional()
  @IsEnum(
    { INPATIENT: 'INPATIENT', OUTPATIENT: 'OUTPATIENT' },
    { message: 'Hình thức điều trị phải là ngoại trú hoặc nội trú.' },
  )
  treatmentMode?: 'INPATIENT' | 'OUTPATIENT';

  @IsOptional()
  @IsInt({ message: 'Số ngày hẹn tái khám phải là số nguyên.' })
  @Min(1, { message: 'Số ngày hẹn tái khám phải từ 1 đến 365 ngày.' })
  @Max(365, { message: 'Số ngày hẹn tái khám phải từ 1 đến 365 ngày.' })
  followUpDays?: number;

  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'Tên người đưa trẻ đến khám phải là chuỗi ký tự.' })
  @MaxLength(200, {
    message: 'Tên người đưa trẻ đến khám không được vượt quá 200 ký tự.',
  })
  caregiverName?: string;
}

export class PrescriptionInputDto {
  @IsOptional()
  @IsObject({ message: 'Thông tin ngữ cảnh đơn thuốc không hợp lệ.' })
  @ValidateNested({
    message: 'Thông tin ngữ cảnh đơn thuốc phải là một đối tượng hợp lệ.',
  })
  @Type(() => PrescriptionContextDto)
  clinicalContext?: PrescriptionContextDto;

  @IsArray({ message: 'Danh sách thuốc phải là một mảng.' })
  @ArrayMinSize(1, { message: 'Đơn thuốc phải có ít nhất 1 dòng thuốc.' })
  @ArrayMaxSize(30, {
    message: 'Mỗi đơn thuốc không được vượt quá 30 dòng thuốc.',
  })
  @IsObject({ each: true, message: 'Dòng thuốc không hợp lệ.' })
  @ValidateNested({
    each: true,
    message: 'Từng dòng thuốc phải là một đối tượng hợp lệ.',
  })
  @Type(() => PrescriptionLineDto)
  details!: PrescriptionLineDto[];

  @Transform(trim)
  @IsOptional()
  @IsString({ message: 'Lời dặn phải là chuỗi ký tự.' })
  @MaxLength(4000, { message: 'Lời dặn không được vượt quá 4000 ký tự.' })
  instructions?: string;

  @IsUUID(undefined, {
    message: 'Mã người nhận đơn không đúng định dạng UUID.',
  })
  recipientUserId!: string;

  @Equals(true, { message: 'Cần xác nhận người nhận có quyền nhận đơn thuốc.' })
  recipientAuthorized!: true;
}

export class SharePrescriptionDto extends PrescriptionInputDto {
  @IsOptional()
  @IsUUID(undefined, { message: 'Mã bệnh nhân không đúng định dạng UUID.' })
  patientId?: string;

  @IsOptional()
  @IsObject({ message: 'Thông tin khám không hợp lệ.' })
  @ValidateNested({ message: 'Thông tin khám phải là một đối tượng hợp lệ.' })
  @Type(() => PrescriptionExamDto)
  exam?: PrescriptionExamDto;
}

export class ReplacePrescriptionDto extends PrescriptionInputDto {
  @Transform(trim)
  @IsString({ message: 'Lý do thay thế phải là chuỗi ký tự.' })
  @MinLength(10, { message: 'Lý do thay thế phải có ít nhất 10 ký tự.' })
  @MaxLength(2000, {
    message: 'Lý do thay thế không được vượt quá 2000 ký tự.',
  })
  replacementReason!: string;
}

export class ConfirmVisitRecordDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Thành viên đang mở trên sổ khám',
  })
  @IsUUID(undefined, { message: 'Mã bệnh nhân không đúng định dạng UUID.' })
  patientId!: string;

  @ApiProperty({
    example: true,
    description: 'Bác sĩ đã kiểm tra và xác nhận nội dung',
  })
  @Equals(true, { message: 'Vui lòng xác nhận nội dung trước khi gửi.' })
  confirmed!: true;

  @ApiPropertyOptional({ type: PrescriptionExamDto })
  @ValidateIf((_object, value) => value !== undefined)
  @IsObject({ message: 'Thông tin khám không hợp lệ.' })
  @ValidateNested({ message: 'Thông tin khám phải là một đối tượng hợp lệ.' })
  @Type(() => PrescriptionExamDto)
  exam?: PrescriptionExamDto;

  @ApiPropertyOptional({ type: PrescriptionInputDto })
  @ValidateIf((_object, value) => value !== undefined)
  @IsObject({ message: 'Thông tin đơn thuốc không hợp lệ.' })
  @ValidateNested({
    message: 'Thông tin đơn thuốc phải là một đối tượng hợp lệ.',
  })
  @Type(() => PrescriptionInputDto)
  prescription?: PrescriptionInputDto;
}

class FamilyPrescriptionEntryDto extends PrescriptionInputDto {
  @IsUUID(undefined, { message: 'Mã buổi khám không đúng định dạng UUID.' })
  encounterId!: string;

  @IsUUID(undefined, { message: 'Mã bệnh nhân không đúng định dạng UUID.' })
  patientId!: string;
}

export class FamilyPrescriptionsDto {
  @IsArray({ message: 'Danh sách đơn gia đình phải là một mảng.' })
  @ArrayMinSize(1, { message: 'Cần có ít nhất 1 đơn thuốc gia đình.' })
  @ArrayMaxSize(30, { message: 'Không được gửi quá 30 đơn thuốc một lần.' })
  @ValidateNested({
    each: true,
    message: 'Từng đơn thuốc gia đình phải là một đối tượng hợp lệ.',
  })
  @Type(() => FamilyPrescriptionEntryDto)
  prescriptions!: FamilyPrescriptionEntryDto[];
}

export class FamilyPrescriptionDateQuery {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'Ngày khám phải đúng định dạng YYYY-MM-DD.',
  })
  @IsDateString({ strict: true }, { message: 'Ngày khám không hợp lệ.' })
  date!: string;
}

export class PrescriptionPageQuery {
  @Type(() => Number)
  @IsInt({ message: 'Số trang phải là số nguyên.' })
  @Min(1, { message: 'Số trang phải lớn hơn hoặc bằng 1.' })
  @Max(100000, { message: 'Số trang vượt quá giới hạn cho phép.' })
  page = 1;
}

export class FamilyPrescriptionQuery extends PrescriptionPageQuery {
  @IsOptional()
  @IsUUID(undefined, { message: 'Mã bệnh nhân không đúng định dạng UUID.' })
  patientId?: string;
}

export class UploadBookDocumentDto {
  @ApiProperty({ maxLength: 200 })
  @Transform(trim)
  @IsString({ message: 'Tên tài liệu phải là chuỗi ký tự.' })
  @IsNotEmpty({ message: 'Vui lòng nhập tên tài liệu.' })
  @MaxLength(200, { message: 'Tên tài liệu không được vượt quá 200 ký tự.' })
  documentName!: string;

  @ApiProperty({ enum: PatientDocumentType })
  @IsEnum(PatientDocumentType, { message: 'Loại tài liệu không hợp lệ.' })
  documentType!: PatientDocumentType;

  @ApiProperty({ example: '2026-11-18' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'Ngày ghi nhận phải đúng định dạng YYYY-MM-DD.',
  })
  @IsDateString({ strict: true }, { message: 'Ngày ghi nhận không hợp lệ.' })
  recordedDate!: string;
}
