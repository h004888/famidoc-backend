import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { PatientStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { CreatePatientDto } from './create-patient.dto';

export class UpdatePatientDto extends PartialType(CreatePatientDto) {
  @ApiPropertyOptional({ enum: PatientStatus, description: 'Trạng thái theo dõi bệnh nhân' })
  @IsOptional()
  @IsEnum(PatientStatus)
  status?: PatientStatus;
}
