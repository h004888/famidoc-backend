import { IsIn, IsString, Matches } from 'class-validator';

export class DoctorManualScheduleDto {
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'proposedDate must be in YYYY-MM-DD format',
  })
  proposedDate!: string;

  @IsIn(['MORNING', 'AFTERNOON'])
  slotWindow!: 'MORNING' | 'AFTERNOON';
}
