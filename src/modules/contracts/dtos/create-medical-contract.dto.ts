import {
  IsInt,
  Max,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateMedicalContractDto {
  @ApiPropertyOptional({
    description: 'Số lượt video thỏa thuận, bắt buộc cho gói năm.',
    minimum: 1,
    maximum: 100000,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100_000)
  videoConsultations?: number;
  @ApiPropertyOptional({
    description: 'Lượt khám tại nhà mua thêm, tính cả phụ thu loại bác sĩ.',
    minimum: 0,
    maximum: 100,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  extraHomeVisits?: number;
  @ApiProperty({
    description: 'ID gói dịch vụ chăm sóc sức khỏe',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @IsUUID('4')
  @IsNotEmpty()
  packageId!: string;

  @ApiProperty({
    description: 'ID cơ sở y tế đảm trách',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @IsUUID('4')
  @IsNotEmpty()
  facilityId!: string;

  @ApiProperty({
    description: 'ID bác sĩ gia đình phân công',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @IsUUID('4')
  @IsNotEmpty()
  doctorId!: string;

  @ApiPropertyOptional({
    description:
      'ID hộ gia đình (bắt buộc nếu Admin tạo, tự động lấy nếu đại diện gia đình tạo)',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @IsUUID('4')
  @IsOptional()
  familyId?: string;

  @ApiPropertyOptional({
    description: 'Số lượng thành viên tham gia chăm sóc',
    default: 1,
  })
  @IsInt()
  @Max(10)
  @Min(1)
  @IsOptional()
  memberCount?: number;
}
export class CreateFourPartyContractDto extends CreateMedicalContractDto {}
