import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class SubmitConsultationRequestDto {
  @ApiProperty({
    description: 'Họ và tên người liên hệ / đại diện gia đình',
    example: 'Nguyễn Văn Minh',
  })
  @IsNotEmpty({ message: 'Họ và tên không được để trống' })
  @IsString()
  @MinLength(2, { message: 'Họ và tên phải có tối thiểu 2 ký tự' })
  @MaxLength(100, { message: 'Họ và tên tối đa 100 ký tự' })
  fullName!: string;

  @ApiProperty({
    description: 'Số điện thoại liên hệ (định dạng Việt Nam)',
    example: '0912345678',
  })
  @IsNotEmpty({ message: 'Số điện thoại không được để trống' })
  @Matches(/(84|0[3|5|7|8|9])+([0-9]{8})\b/, {
    message: 'Số điện thoại không hợp lệ theo định dạng viễn thông Việt Nam',
  })
  phone!: string;

  @ApiProperty({
    description: 'Địa chỉ thư điện tử (email) nhận phản hồi',
    example: 'minh.nguyen@famidoc.vn',
  })
  @IsNotEmpty({ message: 'Email không được để trống' })
  @IsEmail({}, { message: 'Định dạng email không hợp lệ' })
  email!: string;

  @ApiPropertyOptional({
    description: 'Địa chỉ nơi ở của gia đình để điều phối cơ sở y tế gần nhất',
    example: 'Số 25 Phố Huế, Hoàn Kiếm, Hà Nội',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string;

  @ApiPropertyOptional({
    description: 'ID của gói chăm sóc sức khỏe mà gia đình đang quan tâm (nếu có)',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @IsOptional()
  @IsUUID('4', { message: 'ID gói chăm sóc phải là UUID hợp lệ' })
  preferredPackageId?: string;

  @ApiProperty({
    description: 'Mô tả nhu cầu chăm sóc y tế hoặc tình trạng sức khỏe gia đình',
    example:
      'Gia đình có bố mẹ lớn tuổi bị tăng huyết áp và đái tháo đường, cần bác sĩ theo dõi định kỳ tại nhà.',
  })
  @IsNotEmpty({ message: 'Nhu cầu chăm sóc không được để trống' })
  @IsString()
  @MinLength(10, { message: 'Vui lòng mô tả nhu cầu tối thiểu 10 ký tự' })
  @MaxLength(1000, { message: 'Nội dung nhu cầu tối đa 1000 ký tự' })
  healthNeeds!: string;

  @ApiPropertyOptional({
    description: 'Số lượng thành viên trong gia đình cần được chăm sóc',
    example: 4,
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  familyMemberCount: number = 1;
}
