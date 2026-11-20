import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateTreatedCaseDto {
  @ApiProperty({
    description: 'Mô tả ca bệnh tiêu biểu cần kiểm duyệt trước khi công khai',
    example:
      'Quản lý tăng huyết áp kháng trị cho bệnh nhân 72 tuổi kèm suy tim độ II.',
  })
  @IsNotEmpty({ message: 'Nội dung ca bệnh không được để trống' })
  @IsString()
  @MinLength(10, { message: 'Nội dung ca bệnh phải có tối thiểu 10 ký tự' })
  @MaxLength(1000, { message: 'Nội dung ca bệnh tối đa 1000 ký tự' })
  summary: string;
}
