import { PartialType } from '@nestjs/mapped-types';
import { CarePackageTermsDto } from './create-care-package.dto';

// Kế thừa quy tắc kiểm tra điều khoản, nhưng cho phép PATCH chỉ gửi trường muốn sửa.
// Không có code/status/version ở DTO này nên client không tự đổi các trường đó.
// undefined nghĩa là giữ nguyên; null vẫn bị kiểm tra và từ chối.
export class UpdateCarePackageDto extends PartialType(CarePackageTermsDto, {
  skipNullProperties: false, // Không bỏ qua null như một giá trị "không gửi".
}) {}
