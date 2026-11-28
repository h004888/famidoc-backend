import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class DoctorFamilyParamsDto {
  @ApiProperty({ description: 'Mã hộ gia đình (UUID)' })
  @IsUUID('all', { message: 'Mã hộ gia đình không hợp lệ.' })
  familyId!: string;
}
