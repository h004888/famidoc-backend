import { IsInt, Max, Min } from 'class-validator';

// Chỉ nhận số người muốn đăng ký phục vụ, không nhận giá hay hạn mức từ client.
export class QuoteCarePackageDto {
  // Số nguyên từ 1 đến trần kỹ thuật; mức tối đa của từng gói được kiểm tra tiếp.
  @IsInt()
  @Min(1)
  @Max(100)
  memberCount: number;
}
