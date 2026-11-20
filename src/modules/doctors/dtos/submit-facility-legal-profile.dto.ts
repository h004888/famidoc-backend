import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsDateString,
  IsOptional,
  IsString,
  Matches,
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

  @ApiProperty({
    description: 'Địa chỉ trụ sở chính thức của cơ sở y tế theo Giấy phép',
    example: '123 Giải Phóng, Phường Đồng Tâm, Quận Hai Bà Trưng, Hà Nội',
  })
  @IsNotEmpty({ message: 'Địa chỉ trụ sở không được để trống' })
  @IsString()
  @MinLength(5, { message: 'Địa chỉ trụ sở tối thiểu 5 ký tự' })
  @MaxLength(500, { message: 'Địa chỉ trụ sở tối đa 500 ký tự' })
  address!: string;

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

  @ApiPropertyOptional({
    description: 'Mã BIN ngân hàng theo chuẩn NAPAS / VietQR (VD: 970436)',
    example: '970436',
  })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() || undefined : value,
  )
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Matches(/^[0-9]{4,20}$/, {
    message: 'Mã BIN ngân hàng phải gồm 4 đến 20 chữ số',
  })
  bankBin?: string;

  @ApiPropertyOptional({
    description: 'Mã viết tắt ngân hàng theo chuẩn NAPAS / VietQR (VD: VCB)',
    example: 'VCB',
  })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() || undefined : value,
  )
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Matches(/^[A-Z0-9_-]{2,20}$/i, {
    message: 'Mã ngân hàng chỉ gồm chữ cái, số hoặc dấu gạch ngang/dưới (2-20 ký tự)',
  })
  bankCode?: string;

  @ApiProperty({
    description: 'Số tài khoản ngân hàng thụ hưởng của cơ sở y tế (tối đa 19 ký tự chữ/số)',
    example: '0011002233445',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsNotEmpty({ message: 'Số tài khoản ngân hàng không được để trống' })
  @IsString()
  @MaxLength(50)
  @Matches(/^[A-Za-z0-9]{1,19}$/, {
    message: 'Số tài khoản ngân hàng chỉ gồm chữ hoặc số, tối đa 19 ký tự',
  })
  bankAccountNumber!: string;

  @ApiProperty({
    description: 'Tên chủ tài khoản (phải đúng tên pháp nhân hoặc người đại diện hợp pháp)',
    example: 'CONG TY CO PHAN BENH VIEN AN SINH',
  })
  @IsNotEmpty({ message: 'Tên chủ tài khoản không được để trống' })
  @IsString()
  @MaxLength(100)
  bankAccountHolder!: string;

  @ApiProperty({
    description: 'Cơ quan cấp Giấy phép hoạt động KBCB',
    example: 'Bộ Y tế - Cục Quản lý Khám chữa bệnh',
  })
  @IsNotEmpty({ message: 'Cơ quan cấp giấy phép không được để trống' })
  @IsString()
  @MaxLength(255)
  licenseIssuer!: string;

  @ApiProperty({
    description: 'Ngày cấp Giấy phép hoạt động KBCB (YYYY-MM-DD)',
    example: '2024-05-15',
  })
  @IsNotEmpty({ message: 'Ngày cấp giấy phép không được để trống' })
  @IsDateString(
    { strict: true },
    { message: 'Ngày cấp giấy phép phải theo định dạng YYYY-MM-DD hợp lệ' },
  )
  licenseDate!: string;
}
