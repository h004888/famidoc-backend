import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class RejectTreatedCaseDto {
  @ApiProperty({
    description: 'Lý do từ chối công khai ca bệnh',
    example: 'Thông tin chưa đủ căn cứ xác thực hoặc có dấu hiệu nhận diện bệnh nhân.',
  })
  @IsNotEmpty({ message: 'Lý do từ chối không được để trống' })
  @IsString()
  @MinLength(3, { message: 'Lý do từ chối phải có tối thiểu 3 ký tự' })
  @MaxLength(500, { message: 'Lý do từ chối tối đa 500 ký tự' })
  reason: string;
}
