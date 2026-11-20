import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateTreatedCaseDto {
  @ApiPropertyOptional({
    description:
      'Nội dung mới của ca bệnh; khi thay đổi, ca bệnh quay lại trạng thái chờ duyệt',
    example:
      'Điều chỉnh phác đồ đái tháo đường type 2 cho hai thành viên trong cùng hộ gia đình.',
  })
  @IsOptional()
  @IsString()
  @MinLength(10, { message: 'Nội dung ca bệnh phải có tối thiểu 10 ký tự' })
  @MaxLength(1000, { message: 'Nội dung ca bệnh tối đa 1000 ký tự' })
  summary?: string;
}
