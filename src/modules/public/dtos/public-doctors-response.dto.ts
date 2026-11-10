import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationMetaDto } from './public-packages-response.dto';

export class PublicDoctorFacilityDto {
  @ApiProperty({ example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  id!: string;

  @ApiProperty({ example: 'Phòng khám Đa khoa Quốc tế FamiDoc' })
  facilityName!: string;

  @ApiProperty({ example: 'Số 10 Phố Huế, Quận Hai Bà Trưng, Hà Nội' })
  address!: string;

  @ApiProperty({ example: '1900 6868' })
  hotline!: string;
}

export class PublicDoctorItemDto {
  @ApiProperty({ example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  id!: string;

  @ApiProperty({ example: 'BS. CKI Nguyễn Văn A' })
  doctorName!: string;

  @ApiProperty({ example: 'Y học gia đình' })
  specialty!: string;

  @ApiProperty({ example: 'ThS.BS', nullable: true })
  academicTitle!: string | null;

  @ApiProperty({ example: 10, description: 'Số năm kinh nghiệm hành nghề y' })
  experienceYears!: number;

  @ApiProperty({
    example:
      'Chuyên gia Y học gia đình với hơn 10 năm kinh nghiệm điều trị ngoại trú và theo dõi bệnh mãn tính.',
    nullable: true,
  })
  bio!: string | null;

  @ApiProperty({ example: 4.95, description: 'Điểm đánh giá trung bình (1-5 sao)' })
  ratingAvg!: number;

  @ApiProperty({ example: 42, description: 'Tổng số lượt bệnh nhân đánh giá' })
  totalReviews!: number;

  @ApiProperty({
    example: true,
    description:
      'Trạng thái tiếp nhận hộ gia đình mới (dưới hạn mức tối đa 30 hộ)',
  })
  isAvailable!: boolean;

  @ApiPropertyOptional({ type: PublicDoctorFacilityDto, nullable: true })
  facility?: PublicDoctorFacilityDto | null;
}

export class PublicDoctorsResponseDto {
  @ApiProperty({ type: [PublicDoctorItemDto] })
  items!: PublicDoctorItemDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta!: PaginationMetaDto;
}
