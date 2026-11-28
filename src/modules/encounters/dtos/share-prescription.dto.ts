import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  Equals,
  IsArray,
  IsBoolean,
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
import {
  DiseaseProgression,
  HomeMedicationAssessment,
  HomeMedicationSource,
  PatientDocumentType,
  PrescriptionLineChange,
} from '@prisma/client';

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

  @IsOptional()
  @IsEnum(PrescriptionLineChange, {
    message: 'Loại thay đổi thuốc không hợp lệ.',
  })
  changeType?: PrescriptionLineChange;
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
  @Matches(/^[A-Z][0-9]{2}(\.[0-9A-Z]{1,4})?$/i, {
    message: 'Mã ICD-10 không đúng định dạng (ví dụ J06.9, U07.1).',
  })
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

class DiscontinuedMedicationDto {
  @Transform(trim)
  @IsString({ message: 'Tên thuốc ngừng dùng phải là chuỗi ký tự.' })
  @IsNotEmpty({ message: 'Vui lòng nhập tên thuốc ngừng dùng.' })
  @MaxLength(150, {
    message: 'Tên thuốc ngừng dùng không được vượt quá 150 ký tự.',
  })
  medicationName!: string;

  @Transform(trim)
  @IsString({ message: 'Lý do ngừng thuốc phải là chuỗi ký tự.' })
  @MinLength(3, { message: 'Lý do ngừng thuốc phải có ít nhất 3 ký tự.' })
  @MaxLength(500, {
    message: 'Lý do ngừng thuốc không được vượt quá 500 ký tự.',
  })
  reason!: string;
}

export class PrescriptionInputDto {
  @IsOptional()
  @IsObject({ message: 'Thông tin ngữ cảnh đơn thuốc không hợp lệ.' })
  @ValidateNested({
    message: 'Thông tin ngữ cảnh đơn thuốc phải là một đối tượng hợp lệ.',
  })
  @Type(() => PrescriptionContextDto)
  clinicalContext?: PrescriptionContextDto;

  @IsOptional()
  @IsUUID(undefined, {
    message: 'Mã đơn thuốc thay thế không đúng định dạng UUID.',
  })
  replacesPrescriptionId?: string;

  @IsOptional()
  @IsArray({ message: 'Danh sách thuốc ngừng dùng phải là một mảng.' })
  @ArrayMaxSize(30, {
    message: 'Danh sách thuốc ngừng dùng không được vượt quá 30 dòng.',
  })
  @IsObject({ each: true, message: 'Thuốc ngừng dùng không hợp lệ.' })
  @ValidateNested({
    each: true,
    message: 'Từng dòng thuốc ngừng dùng phải là một đối tượng hợp lệ.',
  })
  @Type(() => DiscontinuedMedicationDto)
  discontinuedMedications?: DiscontinuedMedicationDto[];

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

export class VisitVitalsDto {
  @ApiPropertyOptional({ minimum: 50, maximum: 260 })
  @IsOptional()
  @IsInt({ message: 'Huyết áp tâm thu phải là số nguyên.' })
  @Min(50, { message: 'Huyết áp tâm thu phải từ 50 đến 260.' })
  @Max(260, { message: 'Huyết áp tâm thu phải từ 50 đến 260.' })
  systolicBp?: number;

  @ApiPropertyOptional({ minimum: 30, maximum: 160 })
  @IsOptional()
  @IsInt({ message: 'Huyết áp tâm trương phải là số nguyên.' })
  @Min(30, { message: 'Huyết áp tâm trương phải từ 30 đến 160.' })
  @Max(160, { message: 'Huyết áp tâm trương phải từ 30 đến 160.' })
  diastolicBp?: number;

  @ApiPropertyOptional({ minimum: 30, maximum: 220 })
  @IsOptional()
  @IsInt({ message: 'Nhịp tim phải là số nguyên.' })
  @Min(30, { message: 'Nhịp tim phải từ 30 đến 220.' })
  @Max(220, { message: 'Nhịp tim phải từ 30 đến 220.' })
  heartRate?: number;

  @ApiPropertyOptional({ minimum: 34, maximum: 43 })
  @IsOptional()
  @IsNumber({}, { message: 'Nhiệt độ phải là số.' })
  @Min(34, { message: 'Nhiệt độ phải từ 34 đến 43.' })
  @Max(43, { message: 'Nhiệt độ phải từ 34 đến 43.' })
  temperature?: number;

  @ApiPropertyOptional({ minimum: 50, maximum: 100 })
  @IsOptional()
  @IsInt({ message: 'SpO2 phải là số nguyên.' })
  @Min(50, { message: 'SpO2 phải từ 50 đến 100.' })
  @Max(100, { message: 'SpO2 phải từ 50 đến 100.' })
  spo2?: number;

  @ApiPropertyOptional({ minimum: 5, maximum: 60 })
  @IsOptional()
  @IsInt({ message: 'Nhịp thở phải là số nguyên.' })
  @Min(5, { message: 'Nhịp thở phải từ 5 đến 60.' })
  @Max(60, { message: 'Nhịp thở phải từ 5 đến 60.' })
  respiratoryRate?: number;

  @ApiPropertyOptional({ minimum: 0.5, maximum: 300 })
  @IsOptional()
  @IsNumber({}, { message: 'Cân nặng phải là số.' })
  @Min(0.5, { message: 'Cân nặng phải từ 0.5 đến 300.' })
  @Max(300, { message: 'Cân nặng phải từ 0.5 đến 300.' })
  weightKg?: number;

  @ApiPropertyOptional({ minimum: 30, maximum: 250 })
  @IsOptional()
  @IsNumber({}, { message: 'Chiều cao phải là số.' })
  @Min(30, { message: 'Chiều cao phải từ 30 đến 250 cm.' })
  @Max(250, { message: 'Chiều cao phải từ 30 đến 250 cm.' })
  heightCm?: number;
}

export class DraftDiagnosisDto {
  @Transform(trim)
  @IsString({ message: 'Mã ICD-10 phải là chuỗi ký tự.' })
  @IsNotEmpty({ message: 'Vui lòng nhập mã bệnh ICD-10.' })
  @MaxLength(10, { message: 'Mã ICD-10 không được vượt quá 10 ký tự.' })
  @Matches(/^[A-Z][0-9]{2}(\.[0-9A-Z]{1,4})?$/i, {
    message: 'Mã ICD-10 không đúng định dạng (ví dụ J06.9, U07.1).',
  })
  icd10Code!: string;

  @IsBoolean({ message: 'Trạng thái bệnh chính phải là true hoặc false.' })
  isPrimary!: boolean;
}

export class HomeMedicationDto {
  @Transform(trim)
  @IsString({ message: 'Tên thuốc đang dùng phải là chuỗi ký tự.' })
  @IsNotEmpty({ message: 'Vui lòng nhập tên thuốc đang dùng.' })
  @MaxLength(150, {
    message: 'Tên thuốc đang dùng không được vượt quá 150 ký tự.',
  })
  medicationName!: string;

  @IsEnum(HomeMedicationSource, {
    message: 'Nguồn thuốc đang dùng không hợp lệ.',
  })
  source!: HomeMedicationSource;

  @IsEnum(HomeMedicationAssessment, {
    message: 'Đánh giá thuốc đang dùng không hợp lệ.',
  })
  assessment!: HomeMedicationAssessment;

  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'Ghi chú thuốc đang dùng phải là chuỗi ký tự.' })
  @MaxLength(500, {
    message: 'Ghi chú thuốc đang dùng không được vượt quá 500 ký tự.',
  })
  notes?: string;
}

class DraftExamDto {
  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'Lý do khám phải là chuỗi ký tự.' })
  @MaxLength(4000, { message: 'Lý do khám không được vượt quá 4000 ký tự.' })
  chiefComplaint?: string;

  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'Bệnh sử phải là chuỗi ký tự.' })
  @MaxLength(4000, { message: 'Bệnh sử không được vượt quá 4000 ký tự.' })
  anamnesis?: string;

  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'Tên người cung cấp thông tin phải là chuỗi ký tự.' })
  @MaxLength(150, {
    message: 'Tên người cung cấp thông tin không được vượt quá 150 ký tự.',
  })
  informantName?: string;

  @IsOptional()
  @Transform(trim)
  @IsString({
    message: 'Quan hệ người cung cấp thông tin phải là chuỗi ký tự.',
  })
  @MaxLength(50, {
    message: 'Quan hệ người cung cấp thông tin không được vượt quá 50 ký tự.',
  })
  informantRelation?: string;

  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'Tiền sử bản thân phải là chuỗi ký tự.' })
  @MaxLength(4000, {
    message: 'Tiền sử bản thân không được vượt quá 4000 ký tự.',
  })
  personalHistory?: string;

  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'Tiền sử gia đình phải là chuỗi ký tự.' })
  @MaxLength(4000, {
    message: 'Tiền sử gia đình không được vượt quá 4000 ký tự.',
  })
  familyHistory?: string;

  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'Tuân thủ dùng thuốc phải là chuỗi ký tự.' })
  @MaxLength(4000, {
    message: 'Tuân thủ dùng thuốc không được vượt quá 4000 ký tự.',
  })
  medicationAdherence?: string;

  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'Khám toàn thân phải là chuỗi ký tự.' })
  @MaxLength(4000, {
    message: 'Khám toàn thân không được vượt quá 4000 ký tự.',
  })
  generalExam?: string;

  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'Kết quả thăm khám phải là chuỗi ký tự.' })
  @MaxLength(4000, {
    message: 'Kết quả thăm khám không được vượt quá 4000 ký tự.',
  })
  clinicalFindings?: string;

  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'Mã ICD-10 phải là chuỗi ký tự.' })
  @MaxLength(10, { message: 'Mã ICD-10 không được vượt quá 10 ký tự.' })
  icd10Code?: string;

  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'Chẩn đoán phải là chuỗi ký tự.' })
  @MaxLength(255, { message: 'Chẩn đoán không được vượt quá 255 ký tự.' })
  icd10Diagnosis?: string;

  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'Kế hoạch điều trị phải là chuỗi ký tự.' })
  @MaxLength(4000, {
    message: 'Kế hoạch điều trị không được vượt quá 4000 ký tự.',
  })
  treatmentPlan?: string;

  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'Hướng dẫn tự chăm sóc phải là chuỗi ký tự.' })
  @MaxLength(4000, {
    message: 'Hướng dẫn tự chăm sóc không được vượt quá 4000 ký tự.',
  })
  selfCareNotes?: string;

  @IsOptional()
  @IsEnum(DiseaseProgression, { message: 'Diễn tiến bệnh không hợp lệ.' })
  progression?: DiseaseProgression;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'Ngày hẹn tái khám phải theo định dạng YYYY-MM-DD.',
  })
  @IsDateString(
    { strict: true },
    { message: 'Ngày hẹn tái khám phải theo định dạng YYYY-MM-DD.' },
  )
  followUpDate?: string;

  @IsOptional()
  @IsArray({ message: 'Danh sách chẩn đoán phải là một mảng.' })
  @ArrayMaxSize(10, {
    message: 'Mỗi trang khám không được vượt quá 10 chẩn đoán.',
  })
  @IsObject({ each: true, message: 'Chẩn đoán không hợp lệ.' })
  @ValidateNested({
    each: true,
    message: 'Từng chẩn đoán phải là một đối tượng hợp lệ.',
  })
  @Type(() => DraftDiagnosisDto)
  diagnoses?: DraftDiagnosisDto[];

  @IsOptional()
  @IsArray({ message: 'Danh sách thuốc đang dùng phải là một mảng.' })
  @ArrayMaxSize(30, {
    message: 'Danh sách thuốc đang dùng không được vượt quá 30 dòng.',
  })
  @IsObject({ each: true, message: 'Thuốc đang dùng không hợp lệ.' })
  @ValidateNested({
    each: true,
    message: 'Từng dòng thuốc đang dùng phải là một đối tượng hợp lệ.',
  })
  @Type(() => HomeMedicationDto)
  homeMedications?: HomeMedicationDto[];
}

class ConfirmExamDto extends DraftExamDto {
  @Transform(trim)
  @IsString({ message: 'Lý do khám phải là chuỗi ký tự.' })
  @IsNotEmpty({ message: 'Vui lòng nhập lý do khám.' })
  @MaxLength(4000, { message: 'Lý do khám không được vượt quá 4000 ký tự.' })
  declare chiefComplaint: string;

  @Transform(trim)
  @IsString({ message: 'Kết quả thăm khám phải là chuỗi ký tự.' })
  @IsNotEmpty({ message: 'Vui lòng nhập kết quả thăm khám.' })
  @MaxLength(4000, {
    message: 'Kết quả thăm khám không được vượt quá 4000 ký tự.',
  })
  declare clinicalFindings: string;

  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'Mã ICD-10 phải là chuỗi ký tự.' })
  @MaxLength(10, { message: 'Mã ICD-10 không được vượt quá 10 ký tự.' })
  @Matches(/^[A-Z][0-9]{2}(\.[0-9A-Z]{1,4})?$/i, {
    message: 'Mã ICD-10 không đúng định dạng (ví dụ J06.9, U07.1).',
  })
  declare icd10Code?: string;

  @Transform(trim)
  @IsString({ message: 'Kế hoạch điều trị phải là chuỗi ký tự.' })
  @IsNotEmpty({ message: 'Vui lòng nhập kế hoạch điều trị.' })
  @MaxLength(4000, {
    message: 'Kế hoạch điều trị không được vượt quá 4000 ký tự.',
  })
  declare treatmentPlan: string;
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

  @ApiPropertyOptional({ type: ConfirmExamDto })
  @ValidateIf((_object, value) => value !== undefined)
  @IsObject({ message: 'Thông tin khám không hợp lệ.' })
  @ValidateNested({ message: 'Thông tin khám phải là một đối tượng hợp lệ.' })
  @Type(() => ConfirmExamDto)
  exam?: ConfirmExamDto;

  @ApiPropertyOptional({ type: PrescriptionInputDto })
  @ValidateIf((_object, value) => value !== undefined)
  @IsObject({ message: 'Thông tin đơn thuốc không hợp lệ.' })
  @ValidateNested({
    message: 'Thông tin đơn thuốc phải là một đối tượng hợp lệ.',
  })
  @Type(() => PrescriptionInputDto)
  prescription?: PrescriptionInputDto;

  @ApiPropertyOptional({ type: VisitVitalsDto })
  @ValidateIf((_object, value) => value !== undefined)
  @IsObject({ message: 'Thông tin sinh hiệu không hợp lệ.' })
  @ValidateNested({ message: 'Thông tin sinh hiệu phải là một đối tượng hợp lệ.' })
  @Type(() => VisitVitalsDto)
  vitals?: VisitVitalsDto;
}

export class SaveVisitDraftDto {
  @ApiProperty({
    example: '9b44a2a0-2f8d-4bb4-8b2d-f7640e8d0c7e',
    description: 'Mã thành viên được khám',
  })
  @IsUUID(undefined, { message: 'Mã bệnh nhân không đúng định dạng UUID.' })
  patientId!: string;

  @ApiPropertyOptional({ type: DraftExamDto })
  @ValidateIf((_object, value) => value !== undefined)
  @IsObject({ message: 'Thông tin khám không hợp lệ.' })
  @ValidateNested({ message: 'Thông tin khám phải là một đối tượng hợp lệ.' })
  @Type(() => DraftExamDto)
  exam?: DraftExamDto;

  @ApiPropertyOptional({ type: VisitVitalsDto })
  @ValidateIf((_object, value) => value !== undefined)
  @IsObject({ message: 'Thông tin sinh hiệu không hợp lệ.' })
  @ValidateNested({ message: 'Thông tin sinh hiệu phải là một đối tượng hợp lệ.' })
  @Type(() => VisitVitalsDto)
  vitals?: VisitVitalsDto;
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

export class TimelineQuery {
  @IsOptional()
  @IsString({ message: 'Con trỏ phân trang phải là chuỗi ký tự.' })
  @MaxLength(300, { message: 'Con trỏ phân trang không được vượt quá 300 ký tự.' })
  cursor?: string;

  @Type(() => Number)
  @IsInt({ message: 'Số bản ghi phải là số nguyên.' })
  @Min(1, { message: 'Số bản ghi phải lớn hơn hoặc bằng 1.' })
  @Max(50, { message: 'Số bản ghi tối đa là 50.' })
  limit = 20;
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
