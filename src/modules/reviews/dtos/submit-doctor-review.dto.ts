import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
  @ApiProperty({
    description: 'UUID của lượt khám bác sĩ cần gửi đánh giá',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @IsUUID('4')
  encounterId!: string;

  @ApiProperty({
    description: 'Điểm số đánh giá mức độ hài lòng (1 đến 5 sao)',
    example: 5,
    minimum: 1,
    maximum: 5,
  })
  @IsInt()
  @Min(1)
  @Max(5)
  ratingStars!: number;

  @ApiPropertyOptional({
    description: 'Nhận xét, phản hồi chi tiết về chất lượng dịch vụ của bác sĩ',
    example: 'Bác sĩ rất nhiệt tình, giải thích rõ ràng và chu đáo.',
    maxLength: 2000,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(0, 2000)
  reviewComment?: string;
}
