import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsDefined,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

// Chỉ bỏ khoảng trắng ở chuỗi, không ép kiểu dữ liệu sai để vượt qua validation.
const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

// Hai hạn mức dùng chung cho nhóm người được gói phục vụ, không tính riêng từng người.
export class CarePackageQuotasDto {
  @ApiProperty({
    description: 'Số lượt khám tư vấn video trực tuyến trong cả kỳ (bắt buộc > 0)',
    example: 6,
    minimum: 1,
  })
  @IsInt({ message: 'Số lượt tư vấn video phải là số nguyên.' })
  @Min(1, { message: 'Số lượt tư vấn video phải lớn hơn 0.' })
  @Max(100_000, { message: 'Số lượt tư vấn video không được vượt quá 100.000 lượt.' })
  videoConsultations: number;

  @ApiProperty({
    description: 'Số lượt bác sĩ đến khám tận nơi tại nhà trong cả kỳ (bắt buộc > 0)',
    example: 4,
    minimum: 1,
  })
  @IsInt({ message: 'Số lượt khám tại nhà phải là số nguyên.' })
  @Min(1, { message: 'Số lượt khám tại nhà phải lớn hơn 0.' })
  @Max(100_000, { message: 'Số lượt khám tại nhà không được vượt quá 100.000 lượt.' })
  homeVisits: number;
}

export class CarePackageTermsDto {
  @ApiPropertyOptional({
    minimum: 1,
    description:
      'Đơn giá một lần khám tại nhà của cả gia đình, chưa có phụ thu bác sĩ.',
  })
  @ValidateIf((_o, v) => v !== undefined)
  @IsInt({ message: 'Đơn giá lượt khám tại nhà phải là số nguyên.' })
  @Min(1, { message: 'Đơn giá lượt khám tại nhà phải lớn hơn 0đ.' })
  @Max(9_999_999_999, {
    message: 'Đơn giá lượt khám tại nhà không được vượt quá 9.999.999.999đ.',
  })
  homeVisitUnitPriceVnd?: number;

  @ApiProperty({ minLength: 5, maxLength: 50 })
  @Transform(trimString)
  @IsNotEmpty({ message: 'Tên gói không được để trống.' })
  @IsString({ message: 'Tên gói phải là chuỗi ký tự.' })
  @MinLength(5, { message: 'Tên gói phải có ít nhất 5 ký tự.' })
  @MaxLength(50, { message: 'Tên gói không được vượt quá 50 ký tự.' })
  @Matches(/\p{L}/u, { message: 'Tên gói phải chứa ít nhất một chữ cái.' })
  name: string;

  @ApiProperty({ minLength: 20, maxLength: 2000 })
  @Transform(trimString)
  @IsNotEmpty({ message: 'Mô tả gói không được để trống.' })
  @IsString({ message: 'Mô tả gói phải là chuỗi ký tự.' })
  @Length(20, 2000, { message: 'Mô tả gói phải có từ 20 đến 2.000 ký tự.' })
  @Matches(/\p{L}/u, { message: 'Mô tả gói phải chứa ít nhất một chữ cái.' })
  description: string;

  // Thời hạn gói tùy chỉnh tự do miễn là số nguyên dương > 0.
  @ApiProperty({ minimum: 1, example: 4 })
  @IsInt({ message: 'Thời hạn gói phải là số nguyên.' })
  @Min(1, { message: 'Thời hạn gói phải lớn hơn 0 tháng.' })
  durationMonths: number;

  // Giá trọn kỳ cho số người cơ bản, là số nguyên VND dương, không phải giá mỗi tháng.
  @ApiProperty({ minimum: 1, maximum: 9_999_999_999 })
  @IsInt({ message: 'Giá gói trọn kỳ phải là số nguyên.' })
  @Min(1, { message: 'Giá gói trọn kỳ phải lớn hơn 0đ.' })
  @Max(9_999_999_999, {
    message: 'Giá gói trọn kỳ không được vượt quá 9.999.999.999đ.',
  })
  priceVnd: number;

  // Số người được phục vụ trong giá cơ bản; không phải giới hạn cây gia đình.
  @ApiProperty({ minimum: 1, maximum: 10 })
  @IsInt({ message: 'Số thành viên trong giá gói phải là số nguyên.' })
  @Min(1, { message: 'Số thành viên trong giá gói phải từ 1 đến 10 người.' })
  @Max(10, { message: 'Số thành viên trong giá gói phải từ 1 đến 10 người.' })
  includedMembers: number;

  // Tổng số người tối đa sau khi bổ sung; service kiểm tra không thấp hơn includedMembers.
  @ApiProperty({ minimum: 1, maximum: 10 })
  @IsInt({ message: 'Số thành viên tối đa phải là số nguyên.' })
  @Min(1, { message: 'Số thành viên tối đa phải từ 1 đến 10 người.' })
  @Max(10, { message: 'Số thành viên tối đa phải từ 1 đến 10 người.' })
  maxMembers: number;

  // Đơn giá thêm một người/tháng; 0 cho phép miễn phí khi vẫn được thêm người.
  @ApiProperty({ minimum: 0, maximum: 9_999_999_999 })
  @IsInt({ message: 'Phụ phí thêm thành viên phải là số nguyên.' })
  @Min(0, { message: 'Phụ phí thêm thành viên không được nhỏ hơn 0đ.' })
  @Max(9_999_999_999, {
    message: 'Phụ phí thêm thành viên không được vượt quá 9.999.999.999đ.',
  })
  additionalMemberMonthlyPriceVnd: number;

  // Bắt buộc có object quotas và kiểm tra đủ hai trường bên trong.
  @ApiProperty({
    type: () => CarePackageQuotasDto,
    description: 'Chi tiết các hạn mức quyền lợi gói',
  })
  @IsDefined({
    message: 'Vui lòng cung cấp đầy đủ hạn mức khám tại nhà và tư vấn video.',
  })
  @IsObject({
    message: 'Vui lòng cung cấp đầy đủ hạn mức khám tại nhà và tư vấn video.',
  })
  @ValidateNested()
  @Type(() => CarePackageQuotasDto)
  quotas: CarePackageQuotasDto;
}

// Khi tạo mới, Backend tự sinh mã gói (code) duy nhất, không bắt buộc người dùng nhập.
export class CreateCarePackageDto extends CarePackageTermsDto {}

export class ValidateCarePackageDto extends CarePackageTermsDto {
  @ApiPropertyOptional({ description: 'UUID gói đang sửa (nếu có)' })
  @IsOptional()
  @IsUUID('4', { message: 'Mã định danh gói phải là UUID hợp lệ.' })
  packageId?: string;
}
