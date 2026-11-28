import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class HomeEnvironmentParticipantDto {
  @ApiProperty({ example: '10000000-0000-4000-8000-000000000001' })
  @IsUUID(undefined, { message: 'Mã thành viên không đúng định dạng UUID.' })
  patientId!: string;

  @ApiProperty({ enum: ['PLANNED', 'PRESENT', 'ABSENT'] })
  @IsEnum(
    { PLANNED: 'PLANNED', PRESENT: 'PRESENT', ABSENT: 'ABSENT' },
    { message: 'Trạng thái tham gia chỉ nhận PLANNED, PRESENT hoặc ABSENT.' },
  )
  attendanceStatus!: 'PLANNED' | 'PRESENT' | 'ABSENT';

  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'Lý do vắng mặt phải là chuỗi ký tự.' })
  @MaxLength(255, {
    message: 'Lý do vắng mặt không được vượt quá 255 ký tự.',
  })
  absenceReason?: string;
}

export class SaveHomeEnvironmentDto {
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'Địa chỉ buổi khám phải là chuỗi ký tự.' })
  @MaxLength(500, {
    message: 'Địa chỉ buổi khám không được vượt quá 500 ký tự.',
  })
  visitAddress?: string;

  @ApiPropertyOptional({ maxLength: 150 })
  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'Tên người cung cấp thông tin phải là chuỗi ký tự.' })
  @MaxLength(150, {
    message: 'Tên người cung cấp thông tin không được vượt quá 150 ký tự.',
  })
  primaryInformantName?: string;

  @ApiPropertyOptional({ maxLength: 4000 })
  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'Ghi chú điều kiện nhà ở phải là chuỗi ký tự.' })
  @MaxLength(4000, {
    message: 'Ghi chú điều kiện nhà ở không được vượt quá 4000 ký tự.',
  })
  housingNotes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean({ message: 'Nguy cơ té ngã phải là giá trị đúng/sai.' })
  fallRisk?: boolean;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'Nguồn nước sinh hoạt phải là chuỗi ký tự.' })
  @MaxLength(100, {
    message: 'Nguồn nước sinh hoạt không được vượt quá 100 ký tự.',
  })
  waterSource?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean({ message: 'Tình trạng hút thuốc trong nhà phải là đúng/sai.' })
  smokingInHouse?: boolean;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'Thông tin vật nuôi phải là chuỗi ký tự.' })
  @MaxLength(200, {
    message: 'Thông tin vật nuôi không được vượt quá 200 ký tự.',
  })
  pets?: string;

  @ApiPropertyOptional({ maxLength: 4000 })
  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'Ghi chú môi trường sống phải là chuỗi ký tự.' })
  @MaxLength(4000, {
    message: 'Ghi chú môi trường sống không được vượt quá 4000 ký tự.',
  })
  notes?: string;

  @ApiPropertyOptional({ type: [HomeEnvironmentParticipantDto] })
  @IsOptional()
  @IsArray({ message: 'Danh sách thành viên tham gia phải là một mảng.' })
  @ArrayMaxSize(30, {
    message: 'Không được cập nhật quá 30 thành viên một lần.',
  })
  @ValidateNested({
    each: true,
    message: 'Từng thành viên tham gia phải là một đối tượng hợp lệ.',
  })
  @Type(() => HomeEnvironmentParticipantDto)
  participants?: HomeEnvironmentParticipantDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean({ message: 'Tùy chọn sao chép từ buổi trước phải là đúng/sai.' })
  copyFromPreviousVisit?: boolean;
}
