import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class UpdateParticipantAttendanceDto {
  @ApiProperty({
    enum: ['PLANNED', 'ABSENT'],
    description: 'Trạng thái tham gia thực tế của thành viên trong buổi khám',
  })
  @IsIn(['PLANNED', 'ABSENT'], {
    message: 'Trạng thái tham gia phải là PLANNED hoặc ABSENT.',
  })
  attendanceStatus!: 'PLANNED' | 'ABSENT';

  @ApiPropertyOptional({
    description: 'Lý do vắng mặt (bắt buộc khi attendanceStatus = ABSENT)',
  })
  @ValidateIf((o) => o.attendanceStatus === 'ABSENT')
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'Vui lòng nhập lý do vắng (3–255 ký tự).' })
  @MinLength(3, { message: 'Vui lòng nhập lý do vắng (3–255 ký tự).' })
  @MaxLength(255, { message: 'Vui lòng nhập lý do vắng (3–255 ký tự).' })
  absenceReason?: string;
}
