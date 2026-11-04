import { IsNotEmpty, IsNumber, IsOptional, IsUUID, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateMedicalContractDto {
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
  @IsNumber()
  @Min(1)
  @IsOptional()
  memberCount?: number;
}

