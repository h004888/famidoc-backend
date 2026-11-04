import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';
export class SubmitIncidentComplaintDto {
  @IsUUID('4') contractId: string;
  @IsOptional() @IsUUID('4') encounterId?: string;
  @IsIn([
    'DOCTOR_ABSENT',
    'MISSED_VISIT',
    'UNAUTHORIZED_FEE',
    'FAMILY_UNCOOPERATIVE',
    'OTHER',
  ])
  category: string;
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(10, 4000)
  description: string;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ArrayUnique()
  @IsString({ each: true })
  @Length(1, 300, { each: true })
  evidenceKeys?: string[];
}
export class ResolveComplaintDto {
  @IsIn(['INVESTIGATE', 'FACILITY_RESPONSE', 'RESOLVE', 'CLOSE'])
  action: string;
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(10, 4000)
  notes: string;
  // Chỉ có biện pháp phi tài chính; không có trường tiền hoàn/bồi thường.
  @ValidateIf((o) => o.action === 'RESOLVE')
  @IsIn([
    'NO_VIOLATION',
    'WARNING',
    'SERVICE_CORRECTION',
    'REFERRED_TO_FACILITY',
  ])
  outcome?: string;
}
