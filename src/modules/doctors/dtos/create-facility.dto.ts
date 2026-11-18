import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  normalizeVietnameseMobilePhone,
  VN_MOBILE_PHONE_REGEX,
} from '../utils/vietnamese-phone.util';

export class CreateFacilityDto {
  @ApiProperty({
    description: 'Tên cơ sở y tế (Bệnh viện / Phòng khám)',
    example: 'Bệnh viện Đa khoa Quốc tế An Sinh',
  })
  @IsNotEmpty({ message: 'Tên cơ sở y tế không được để trống' })
  @IsString()
  @MinLength(3, { message: 'Tên cơ sở y tế tối thiểu 3 ký tự' })
  @MaxLength(255, { message: 'Tên cơ sở y tế tối đa 255 ký tự' })
  facilityName!: string;

  @ApiProperty({
    description: 'Họ và tên người đại diện pháp luật / liên hệ của cơ sở y tế',
    example: 'Nguyễn Văn Tuấn',
  })
  @IsNotEmpty({ message: 'Tên người đại diện không được để trống' })
  @IsString()
  @MinLength(2, { message: 'Tên người đại diện tối thiểu 2 ký tự' })
  @MaxLength(100, { message: 'Tên người đại diện tối đa 100 ký tự' })
  representativeName!: string;

  @ApiProperty({
    description: 'Email chính thức của cơ sở y tế để nhận tài khoản đăng nhập',
    example: 'contact@ansinhhospital.vn',
  })
  @IsNotEmpty({ message: 'Email không được để trống' })
  @IsEmail({}, { message: 'Định dạng email không hợp lệ' })
  email!: string;

  @ApiProperty({
    description: 'Số điện thoại di động của người đại diện (định dạng Việt Nam)',
    example: '0987654321',
  })
  @Transform(({ value }) =>
    typeof value === 'string' ? normalizeVietnameseMobilePhone(value) : value,
  )
  @IsNotEmpty({ message: 'Số điện thoại không được để trống' })
  @Matches(VN_MOBILE_PHONE_REGEX, {
    message: 'Số điện thoại không đúng định dạng di động Việt Nam',
  })
  phone!: string;

  @ApiPropertyOptional({
    description: 'Địa chỉ trụ sở của cơ sở y tế (tùy chọn khi tạo tài khoản)',
    example: '123 Giải Phóng, Phường Đồng Tâm, Quận Hai Bà Trưng, Hà Nội',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'Địa chỉ tối đa 500 ký tự' })
  address?: string;
}
