import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { QuotaProposalStatus } from '@prisma/client';

export class CreateDoctorQuotaProposalDto {
  @ApiProperty({
    description: 'Hạn mức số hộ gia đình tối đa đề xuất mới',
    example: 40,
    minimum: 1,
    maximum: 200,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  requestedMaxPanel!: number;

  @ApiProperty({
    description: 'Lý do đề xuất điều chỉnh hạn mức hộ gia đình',
    example: 'Bác sĩ có thêm 2 điều dưỡng hỗ trợ theo dõi tại nhà nên đủ năng lực tiếp nhận 40 hộ.',
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(5)
  @MaxLength(1000)
  reason!: string;
}

export class ReviewDoctorQuotaProposalDto {
  @ApiProperty({
    enum: ['APPROVE', 'REJECT'],
    description: 'Quyết định của Quản trị viên: APPROVE hoặc REJECT',
  })
  @IsIn(['APPROVE', 'REJECT'])
  action!: 'APPROVE' | 'REJECT';

  @ApiPropertyOptional({
    description: 'Ghi chú thẩm định (bắt buộc khi từ chối)',
    example: 'Đã đối soát nhân sự hỗ trợ tại cơ sở, chấp thuận tăng hạn mức.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reviewNote?: string;
}

export class ListQuotaProposalsQueryDto {
  @ApiPropertyOptional({ enum: QuotaProposalStatus })
  @IsOptional()
  @IsEnum(QuotaProposalStatus)
  status?: QuotaProposalStatus;

  @ApiPropertyOptional({ example: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ example: 20, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
