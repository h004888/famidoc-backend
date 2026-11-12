import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class LookupDoctorReviewsQueryDto {
  @ApiPropertyOptional({
    description: 'Số thứ tự trang hiển thị (bắt đầu từ 1)',
    example: 1,
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    description: 'Số lượng đánh giá trên mỗi trang (tối đa 50)',
    example: 5,
    default: 5,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 5;

  @ApiPropertyOptional({
    description: 'Lọc theo số sao đánh giá (1 - 5)',
    example: 5,
    minimum: 1,
    maximum: 5,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;
}

export class PublicDoctorReviewItemDto {
  @ApiProperty({
    description: 'Mã định danh duy nhất (UUID) của đánh giá',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  id: string;

  @ApiProperty({
    description: 'Họ tên hoặc danh xưng của người đại diện hộ gia đình đánh giá',
    example: 'Chị Mai Lan',
  })
  patientName: string;

  @ApiProperty({
    description: 'Số sao đánh giá (1 đến 5 sao)',
    example: 5,
    minimum: 1,
    maximum: 5,
  })
  ratingStars: number;

  @ApiPropertyOptional({
    description: 'Nội dung nhận xét phản hồi từ gia đình',
    example:
      'Bác sĩ Hoài rất tận tình, giải thích chi tiết phác đồ chăm sóc cho mẹ già và bé nhỏ.',
  })
  comment?: string | null;

  @ApiPropertyOptional({
    description: 'Tên gói chăm sóc sức khỏe gia đình đang sử dụng',
    example: 'Gói Đồng Hành',
  })
  packageName?: string | null;

  @ApiPropertyOptional({
    description: 'Khu vực / Quận huyện của hộ gia đình',
    example: 'Quận 7',
  })
  district?: string | null;

  @ApiPropertyOptional({
    description: 'Ảnh đại diện người đánh giá',
    example: '/images/medsev/avatar/female-1.jpg',
  })
  avatarUrl?: string | null;

  @ApiProperty({
    description: 'Thời điểm gửi đánh giá',
    example: '2026-11-01T08:30:00.000Z',
  })
  createdAt: Date | string;
}

export class PublicDoctorReviewsPaginationMetaDto {
  @ApiProperty({ description: 'Tổng số lượt đánh giá thỏa mãn điều kiện', example: 12 })
  total: number;

  @ApiProperty({ description: 'Trang hiện tại', example: 1 })
  page: number;

  @ApiProperty({ description: 'Số lượng mục trên mỗi trang', example: 5 })
  limit: number;

  @ApiProperty({ description: 'Tổng số trang', example: 3 })
  totalPages: number;
}

export class PublicDoctorReviewsResponseDto {
  @ApiProperty({
    description: 'Danh sách đánh giá',
    type: [PublicDoctorReviewItemDto],
  })
  items: PublicDoctorReviewItemDto[];

  @ApiProperty({
    description: 'Thông tin phân trang',
    type: PublicDoctorReviewsPaginationMetaDto,
  })
  meta: PublicDoctorReviewsPaginationMetaDto;
}
