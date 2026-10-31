import { Transform } from 'class-transformer';
import { IsEnum, IsInt, Max, Min, ValidateIf } from 'class-validator';
import { CarePackageStatus } from '../entities/care-package.entity';

// Query HTTP là chuỗi: chỉ chuyển chuỗi toàn chữ số; giữ đầu vào khác để DTO báo lỗi.
// Không dùng Number trực tiếp vì chuỗi rỗng hoặc dạng số mũ có thể bị hiểu nhầm.
const parseInteger = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;

export class ListCarePackagesDto {
  // Trang bắt đầu từ 1; giới hạn trên tránh chỉ số phân trang quá lớn.
  @Transform(parseInteger)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  page: number = 1;

  // Mặc định 20 bản ghi, tối đa 100 để hạn chế trả dữ liệu quá nhiều một lần.
  @Transform(parseInteger)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}

export class AdminListCarePackagesDto extends ListCarePackagesDto {
  // Chỉ API quản trị mới nhận bộ lọc trạng thái; không gửi thì xem mọi trạng thái.
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsEnum(CarePackageStatus)
  status?: CarePackageStatus;
}
