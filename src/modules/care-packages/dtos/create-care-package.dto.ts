import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsDefined,
  IsEnum,
  IsInt,
  IsIn,
  IsObject,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { QuotaPeriod } from '../entities/care-package.entity';

// Chỉ bỏ khoảng trắng ở chuỗi, không ép kiểu dữ liệu sai để vượt qua validation.
const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

// Ba hạn mức dùng chung cho nhóm người được gói phục vụ, không tính riêng từng người.
export class CarePackageQuotasDto {
  // Số lượt video: cho phép 0; trần 100.000 là giới hạn kỹ thuật, chưa phải bảng quyền lợi.
  @ApiProperty({
    description: 'Số lượt khám tư vấn video trực tuyến',
    example: 10,
    default: 0,
  })
  @IsInt()
  @Min(0)
  @Max(100_000)
  videoConsultations: number;

  // Số lượt khám tại nhà trong chu kỳ cấu hình của gói.
  @ApiProperty({
    description: 'Số lượt bác sĩ đến khám tận nơi tại nhà',
    example: 4,
    default: 0,
  })
  @IsInt()
  @Min(0)
  @Max(100_000)
  homeVisits: number;

  // Khám tại cơ sở ngoài phạm vi gói hiện tại; giữ field cũ tương thích response.
  @ApiProperty({
    description: 'Số lượt khám tại cơ sở y tế (mặc định 0)',
    example: 0,
    default: 0,
  })
  @IsInt()
  @Min(0)
  @Max(0)
  facilityVisits: number;
}

export class CarePackageTermsDto {
  @ApiPropertyOptional({
    enum: ['FIXED', 'CONTRACT'],
    description:
      'FIXED cho gói 1/3/6 tháng; CONTRACT cho quota năm được chốt khi ký.',
  })
  @ValidateIf((_o, v) => v !== undefined)
  @IsIn(['FIXED', 'CONTRACT'])
  videoQuotaPolicy?: 'FIXED' | 'CONTRACT';
  @ApiPropertyOptional({
    minimum: 1,
    description:
      'Đơn giá một lần khám tại nhà của cả gia đình, chưa có phụ thu bác sĩ.',
  })
  @ValidateIf((_o, v) => v !== undefined)
  @IsInt()
  @Min(1)
  @Max(9_999_999_999)
  homeVisitUnitPriceVnd?: number;
  // Tên không được rỗng sau khi loại khoảng trắng đầu/cuối.
  @Transform(trimString)
  @IsString()
  @Length(1, 120)
  name: string;

  // Có thể không gửi mô tả; nếu đã gửi thì phải là chuỗi, không chấp nhận null.
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(trimString)
  @IsString()
  @Length(0, 2000)
  description?: string;

  // Bốn kỳ hạn của catalog 05/11/2026.
  @IsInt()
  @Min(1)
  @IsIn([1, 3, 6, 12])
  durationMonths: number;

  // Giá trọn kỳ cho số người cơ bản, là số nguyên VND dương, không phải giá mỗi tháng.
  @IsInt()
  @Min(1)
  @Max(9_999_999_999)
  priceVnd: number;

  // Số người được phục vụ trong giá cơ bản; không phải giới hạn cây gia đình.
  @IsInt()
  @Min(1)
  @Max(10)
  includedMembers: number;

  // Tổng số người tối đa sau khi bổ sung; service kiểm tra không thấp hơn includedMembers.
  @IsInt()
  @Min(1)
  @Max(10)
  maxMembers: number;

  // Đơn giá thêm một người/tháng; 0 cho phép miễn phí khi vẫn được thêm người.
  @IsInt()
  @Min(0)
  @Max(9_999_999_999)
  additionalMemberMonthlyPriceVnd: number;

  // Chọn hạn mức cho toàn kỳ hoặc cho từng tháng hợp đồng.
  @ApiProperty({
    enum: QuotaPeriod,
    enumName: 'QuotaPeriod',
    description: 'Kỳ hạn áp dụng hạn mức gói (PER_TERM hoặc PER_MONTH)',
  })
  @IsEnum(QuotaPeriod)
  quotaPeriod: QuotaPeriod;

  // Bắt buộc có object quotas và kiểm tra đủ ba trường bên trong.
  // @Type giúp dữ liệu JSON lồng nhau trở thành DTO để @ValidateNested hoạt động.
  @ApiProperty({
    type: () => CarePackageQuotasDto,
    description: 'Chi tiết các hạn mức quyền lợi gói',
  })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => CarePackageQuotasDto)
  quotas: CarePackageQuotasDto;
}

export class CreateCarePackageDto extends CarePackageTermsDto {
  // Mã ổn định qua các phiên bản: bắt đầu bằng chữ hoa, chỉ gồm chữ hoa/số/dấu gạch dưới.
  @Transform(trimString)
  @IsString()
  @Length(2, 40)
  @Matches(/^[A-Z][A-Z0-9_]*$/, {
    message: 'code must use uppercase letters, digits or underscores',
  })
  code: string;
}
