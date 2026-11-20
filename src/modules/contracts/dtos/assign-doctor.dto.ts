import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsUUID } from 'class-validator';

export class AssignDoctorToPackageDto {
  @ApiProperty({
    description: 'UUID của Bác sĩ gia đình được chỉ định phụ trách hợp đồng',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @IsUUID('4', { message: 'ID bác sĩ phải theo định dạng UUID v4' })
  @IsNotEmpty({ message: 'Vui lòng chỉ định ID bác sĩ (doctorId)' })
  doctorId!: string;
}
