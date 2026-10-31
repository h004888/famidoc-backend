import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';
export class SubmitDoctorReviewDto {
  @IsUUID('4') encounterId: string;
  @IsInt() @Min(1) @Max(5) ratingStars: number;
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(0, 2000)
  reviewComment?: string;
}
