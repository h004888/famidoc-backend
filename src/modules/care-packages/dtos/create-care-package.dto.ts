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
  @IsInt()
  @Min(0)
  @Max(100_000)
  videoConsultations: number;

  // Số lượt khám tại nhà trong chu kỳ cấu hình của gói.
  @IsInt()
  @Min(0)
  @Max(100_000)
  homeVisits: number;

  // Khám tại cơ sở ngoài phạm vi gói hiện tại; giữ field cũ tương thích response.
  @IsInt()
  @Min(0)
  @Max(0)
  facilityVisits: number;
}

export class CarePackageTermsDto {
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

  // Ba kỳ hạn theo bảng giá mới: dùng thử 1 tháng, quý 3 tháng và năm 12 tháng.
  @IsInt()
  @Min(1)
  @IsIn([1, 3, 12])
  durationMonths: number;

  // Giá trọn kỳ cho số người cơ bản, là số nguyên VND dương, không phải giá mỗi tháng.
  @IsInt()
  @Min(1)
  @Max(9_999_999_999)
  priceVnd: number;

  // Số người được phục vụ trong giá cơ bản; không phải giới hạn cây gia đình.
  @IsInt()
  @Min(1)
  @Max(6)
  includedMembers: number;

  // Tổng số người tối đa sau khi bổ sung; service kiểm tra không thấp hơn includedMembers.
  @IsInt()
  @Min(1)
  @Max(6)
  maxMembers: number;

  // Đơn giá thêm một người/tháng; 0 cho phép miễn phí khi vẫn được thêm người.
  @IsInt()
  @Min(0)
  @Max(9_999_999_999)
  additionalMemberMonthlyPriceVnd: number;

  // Chọn hạn mức cho toàn kỳ hoặc cho từng tháng hợp đồng.
  @IsEnum(QuotaPeriod)
  quotaPeriod: QuotaPeriod;

  // Bắt buộc có object quotas và kiểm tra đủ ba trường bên trong.
  // @Type giúp dữ liệu JSON lồng nhau trở thành DTO để @ValidateNested hoạt động.
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
