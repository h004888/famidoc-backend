import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsISO8601,
  IsNotEmpty,
  IsString,
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

  @ApiProperty({
    example: 'https://cdn.famidoc.vn/credentials/cchn-bs-an.pdf',
    description: 'Đường dẫn file scan / hình ảnh văn bằng chứng chỉ (PDF/PNG)',
  })
  @IsNotEmpty({ message: 'Đường dẫn file không được để trống' })
  @IsString()
  fileUrl!: string;
}

export class SubmitDoctorCredentialsDto {
  @ApiProperty({
    type: [CredentialItemDto],
    description:
      'Danh sách văn bằng, chứng chỉ hành nghề và chứng nhận Y học gia đình',
  })
  @IsArray({ message: 'credentials phải là một mảng danh sách' })
  @ArrayMinSize(1, { message: 'Phải tải lên ít nhất 1 chứng chỉ hoặc văn bằng' })
  @ValidateNested({ each: true })
  @Type(() => CredentialItemDto)
  credentials!: CredentialItemDto[];
}
