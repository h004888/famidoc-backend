import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  normalizeVietnameseMobilePhone,
  VN_MOBILE_PHONE_REGEX,
} from '../utils/vietnamese-phone.util';

export class ProvisionDoctorDto {
  @ApiProperty({
    description: 'Địa chỉ email đăng nhập của bác sĩ',
    example: 'bs.nguyenvanan@famidoc.vn',
  })
  @IsNotEmpty({ message: 'Email không được để trống' })
  @IsEmail({}, { message: 'Định dạng email không hợp lệ' })
  email!: string;

  @ApiProperty({
    description: 'Số điện thoại của bác sĩ (định dạng Việt Nam)',
    example: '0912345678',
  })
  @Transform(({ value }) =>
    typeof value === 'string' ? normalizeVietnameseMobilePhone(value) : value,
  )
  @IsNotEmpty({ message: 'Số điện thoại không được để trống' })
  @Matches(VN_MOBILE_PHONE_REGEX, {
    message: 'Số điện thoại không đúng định dạng di động Việt Nam',
  })
  phone!: string;

  @ApiProperty({
    description: 'Họ và tên đầy đủ của bác sĩ',
    example: 'BS. CKI Nguyễn Văn An',
  })
  @IsNotEmpty({ message: 'Tên bác sĩ không được để trống' })
  @IsString()
  @MinLength(2, { message: 'Tên bác sĩ tối thiểu 2 ký tự' })
  @MaxLength(100, { message: 'Tên bác sĩ tối đa 100 ký tự' })
  doctorName!: string;

  @ApiPropertyOptional({
    description: 'Chuyên khoa y tế',
    example: 'Y học gia đình',
    default: 'Y học gia đình',
  })
  @IsOptional()
  @IsString()
  specialty: string = 'Y học gia đình';

  @ApiPropertyOptional({
    description: 'Học hàm / học vị (BS, ThS.BS, BSCKI, PGS.TS...)',
    example: 'BS.CKI',
  })
  @IsOptional()
  @IsString()
  academicTitle?: string;

  @ApiPropertyOptional({
    description: 'Số năm kinh nghiệm hành nghề lâm sàng (mặc định 0 nếu bác sĩ tự cập nhật sau)',
    example: 0,
    default: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Số năm kinh nghiệm phải là số nguyên' })
  @Min(0, { message: 'Số năm kinh nghiệm không thể âm' })
  experienceYears?: number = 0;

  @ApiPropertyOptional({
    description: 'Tóm tắt tiểu sử chuyên môn và định hướng khám chữa bệnh',
    example:
      'Chuyên gia Y học gia đình với 8 năm kinh nghiệm khám bệnh tại nhà và quản lý bệnh không lây nhiễm.',
  })
  @IsOptional()
  @IsString()
  bio?: string;

  @ApiPropertyOptional({
    description:
      'UUID của cơ sở y tế trực thuộc (hệ thống tự động suy diễn theo tài khoản Cơ sở y tế đang đăng nhập)',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @IsOptional()
  @IsUUID('4', { message: 'facilityId phải là UUID hợp lệ' })
  facilityId?: string;
}
