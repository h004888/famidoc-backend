import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class SubmitFacilityLegalProfileDto {
  @ApiPropertyOptional({
    description: 'Tên pháp nhân cơ sở y tế theo Giấy phép (nếu có điều chỉnh)',
    example: 'Bệnh viện Đa khoa Quốc tế An Sinh',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  facilityName?: string;

  @ApiProperty({
    description: 'Số Giấy phép hoạt động khám bệnh, chữa bệnh (GPHĐ) do Bộ Y tế / Sở Y tế cấp',
    example: '01293/BYT-GPHĐ',
  })
  @IsNotEmpty({ message: 'Số giấy phép hoạt động không được để trống' })
  @IsString()
  @MinLength(3, { message: 'Số giấy phép tối thiểu 3 ký tự' })
  @MaxLength(50, { message: 'Số giấy phép tối đa 50 ký tự' })
  licenseNumber!: string;

  @ApiProperty({
    description: 'Mã số thuế doanh nghiệp (10 hoặc 13 số)',
    example: '0102030405',
  })
  @IsNotEmpty({ message: 'Mã số thuế không được để trống' })
  @IsString()
  @MinLength(10, { message: 'Mã số thuế tối thiểu 10 ký tự' })
  @MaxLength(20, { message: 'Mã số thuế tối đa 20 ký tự' })
  taxCode!: string;

  @ApiPropertyOptional({
    description: 'Địa chỉ trụ sở chính thức của cơ sở y tế (nếu có điều chỉnh)',
    example: '123 Giải Phóng, Phường Đồng Tâm, Quận Hai Bà Trưng, Hà Nội',
  })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiProperty({
    description: 'Số điện thoại đường dây nóng y tế',
    example: '19001234',
  })
  @IsNotEmpty({ message: 'Hotline không được để trống' })
  @IsString()
  @MaxLength(15, { message: 'Hotline tối đa 15 ký tự' })
  hotline!: string;

  @ApiProperty({
    description: 'Tên ngân hàng mở tài khoản phục vụ quyết toán doanh thu B2B',
    example: 'Ngân hàng TMCP Ngoại thương Việt Nam (Vietcombank)',
  })
  @IsNotEmpty({ message: 'Tên ngân hàng không được để trống' })
  @IsString()
  @MaxLength(100)
  bankName!: string;

  @ApiProperty({
    description: 'Số tài khoản ngân hàng thụ hưởng của cơ sở y tế',
    example: '0011002233445',
  })
  @IsNotEmpty({ message: 'Số tài khoản ngân hàng không được để trống' })
  @IsString()
  @MaxLength(50)
  bankAccountNumber!: string;

  @ApiProperty({
    description: 'Tên chủ tài khoản (phải đúng tên pháp nhân hoặc người đại diện hợp pháp)',
    example: 'CONG TY CO PHAN BENH VIEN AN SINH',
  })
  @IsNotEmpty({ message: 'Tên chủ tài khoản không được để trống' })
  @IsString()
  @MaxLength(100)
  bankAccountHolder!: string;

  @ApiPropertyOptional({
    description: 'Đường dẫn file PDF scan tập hợp hồ sơ pháp lý (GPHĐ, ĐKKD, Đề xuất hợp tác)',
    example: 'https://cdn.famidoc.vn/facilities/legal/gphd-ansinh-signed.pdf',
  })
  @IsOptional()
  @IsString()
  legalDocumentsUrl?: string;
}
