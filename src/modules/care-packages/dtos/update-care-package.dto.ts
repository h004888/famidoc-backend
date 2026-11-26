import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsOptional, IsString, Length } from 'class-validator';
import { CarePackageTermsDto } from './create-care-package.dto';

// Kế thừa quy tắc kiểm tra điều khoản, nhưng cho phép PATCH chỉ gửi trường muốn sửa.
// Không có code/status/version ở DTO này nên client không tự đổi các trường đó.
// undefined nghĩa là giữ nguyên; null vẫn bị kiểm tra và từ chối.
export class UpdateCarePackageDto extends PartialType(CarePackageTermsDto, {
  skipNullProperties: false,
}) {}

export class UpdateCarePackageWithAckDto extends UpdateCarePackageDto {
  @ApiPropertyOptional({ type: [String], example: ['P2'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @Length(1, 10, { each: true })
  acknowledgedWarnings?: string[];
}
