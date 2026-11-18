import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { DoctorCredentialType } from '@prisma/client';

export class CredentialItemDto {
  @ApiProperty({
    enum: DoctorCredentialType,
    example: DoctorCredentialType.PRACTICE_LICENSE_CCHN,
    description:
      'Loại giấy tờ chuyên môn (PRACTICE_LICENSE_CCHN, FAMILY_MEDICINE_CERT, DEGREE)',
  })
  @IsEnum(DoctorCredentialType, {
    message: 'Loại chứng chỉ/bằng cấp không hợp lệ',
  })
  credentialType!: DoctorCredentialType;

  @ApiProperty({
    example: 'CCHN-001234/BYT',
    description: 'Số chứng chỉ / mã hiệu bằng cấp',
  })
  @IsNotEmpty({ message: 'Số chứng chỉ không được để trống' })
  @IsString()
  certificateNumber!: string;

  @ApiProperty({
    example: '2020-05-15',
    description: 'Ngày cấp (định dạng YYYY-MM-DD hoặc ISO8601)',
  })
  @IsISO8601(
    { strict: false },
    { message: 'Ngày cấp phải theo định dạng ISO8601' },
  )
  issueDate!: string;

  @ApiProperty({
    example: 'Bộ Y tế Việt Nam',
    description: 'Cơ quan có thẩm quyền cấp chứng chỉ',
  })
  @IsNotEmpty({ message: 'Cơ quan cấp không được để trống' })
  @IsString()
  issuingAuthority!: string;

  @ApiPropertyOptional({
    description: 'Đường dẫn file chứng chỉ (hệ thống tự sinh từ tệp scan tải lên)',
  })
  @IsOptional()
  @IsString()
  fileUrl?: string;
}

export class SubmitDoctorCredentialsDto {
  @ApiPropertyOptional({
    description: 'Học hàm / học vị (BS, ThS.BS, BS.CKI, PGS.TS...)',
    example: 'BS.CKI',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  academicTitle?: string;

  @ApiPropertyOptional({
    description: 'Chuyên khoa hành nghề',
    example: 'Y học gia đình',
  })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  specialty?: string;

  @ApiPropertyOptional({
    description: 'Số năm kinh nghiệm hành nghề',
    example: 6,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Số năm kinh nghiệm phải là số nguyên' })
  @Min(0, { message: 'Số năm kinh nghiệm không thể âm' })
  experienceYears?: number;

  @ApiPropertyOptional({
    description: 'Tiểu sử chuyên môn & kinh nghiệm công tác của bác sĩ',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  bio?: string;

  @ApiProperty({
    type: [CredentialItemDto],
    description:
      'Danh sách đầy đủ 3 loại văn bằng chứng chỉ: CCHN, Bằng tốt nghiệp, Chứng nhận Y học gia đình',
  })
  @Transform(({ value }) => {
    let parsed = value;
    if (typeof value === 'string') {
      try {
        parsed = JSON.parse(value);
      } catch {
        return value;
      }
    }
    if (Array.isArray(parsed)) {
      return parsed.map((item) => plainToInstance(CredentialItemDto, item));
    }
    return parsed;
  })
  @IsArray({ message: 'credentials phải là một mảng danh sách' })
  @ArrayMinSize(3, {
    message:
      'Bác sĩ phải nộp đủ 3 loại giấy tờ: CCHN, Bằng chuyên môn và Chứng chỉ Y học gia đình',
  })
  @ValidateNested({ each: true })
  @Type(() => CredentialItemDto)
  credentials!: CredentialItemDto[];
}
