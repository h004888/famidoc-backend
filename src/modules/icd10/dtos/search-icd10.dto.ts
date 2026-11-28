import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Min,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const toOptionalBoolean = ({ value }: { value: unknown }) => {
  if (value === 'true' || value === true) return true;
  if (value === 'false' || value === false) return false;
  return value;
};

export class SearchIcd10Dto {
  @ApiProperty({
    description: 'Từ khóa tra cứu theo mã ICD-10 hoặc tên bệnh tiếng Việt',
    example: 'I10',
    minLength: 1,
    maxLength: 100,
  })
  @Transform(trim)
  @IsString({ message: 'Từ khóa tra cứu phải từ 1 đến 100 ký tự.' })
  @Length(1, 100, { message: 'Từ khóa tra cứu phải từ 1 đến 100 ký tự.' })
  q!: string;

  @ApiPropertyOptional({
    description: 'Chỉ lấy các mã ICD-10 được phép làm chẩn đoán chính',
    example: true,
  })
  @IsOptional()
  @Transform(toOptionalBoolean)
  @IsBoolean({ message: 'primaryOnly phải là giá trị đúng hoặc sai.' })
  primaryOnly?: boolean;

  @ApiPropertyOptional({
    description: 'Số kết quả tối đa (mặc định 20, tối đa 50)',
    example: 20,
    minimum: 1,
    maximum: 50,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit phải là số nguyên.' })
  @Min(1, { message: 'limit phải lớn hơn hoặc bằng 1.' })
  limit?: number;
}
