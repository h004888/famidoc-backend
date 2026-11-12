import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterFacilityDto {
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
    description: 'Email chính thức của cơ sở y tế để nhận thông báo và tài khoản quản trị',
    example: 'contact@ansinhhospital.vn',
  })
  @IsNotEmpty({ message: 'Email không được để trống' })
  @IsEmail({}, { message: 'Định dạng email không hợp lệ' })
  email!: string;

  @ApiProperty({
    description: 'Số điện thoại di động của người đại diện (định dạng Việt Nam)',
    example: '0987654321',
  })
  @IsNotEmpty({ message: 'Số điện thoại không được để trống' })
  @Matches(/(84|0[3|5|7|8|9])+([0-9]{8})\b/, {
    message: 'Số điện thoại không đúng định dạng di động Việt Nam',
  })
  phone!: string;

  @ApiProperty({
    description: 'Địa chỉ trụ sở của cơ sở y tế',
    example: '123 Giải Phóng, Phường Đồng Tâm, Quận Hai Bà Trưng, Hà Nội',
  })
  @IsNotEmpty({ message: 'Địa chỉ không được để trống' })
  @IsString()
  @MinLength(5, { message: 'Địa chỉ tối thiểu 5 ký tự' })
  address!: string;
}
