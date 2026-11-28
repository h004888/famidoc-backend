import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Gender } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';

export class UpdateVisitPatientProfileDto {
  @ApiProperty({ description: 'Mã thành viên gia đình' })
  @IsUUID('4', { message: 'Mã thành viên không hợp lệ.' })
  patientId!: string;

  @ApiPropertyOptional({
    description: 'Ngày sinh (định dạng YYYY-MM-DD)',
    example: '2022-05-01',
  })
  @IsOptional()
  @IsDateString({}, { message: 'Ngày sinh không đúng định dạng YYYY-MM-DD.' })
  dateOfBirth?: string;

  @ApiPropertyOptional({ enum: Gender, description: 'Giới tính sinh học' })
  @IsOptional()
  @IsEnum(Gender, { message: 'Giới tính không hợp lệ.' })
  gender?: Gender;
}
