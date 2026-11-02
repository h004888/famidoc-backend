import { ApiProperty } from '@nestjs/swagger';
import { PaginationMetaDto } from './public-packages-response.dto';

export class PublicFacilityItemDto {
  @ApiProperty({ example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  id!: string;

  @ApiProperty({ example: 'Phòng khám Đa khoa Quốc tế FamiDoc Hà Nội' })
  facilityName!: string;

  @ApiProperty({ example: 'GPHN-01234/BYT' })
  licenseNumber!: string;

  @ApiProperty({ example: 'Số 10 Phố Huế, Quận Hai Bà Trưng, Hà Nội' })
  address!: string;

  @ApiProperty({ example: '1900 6868' })
  hotline!: string;

  @ApiProperty({
    example: 8,
    description: 'Số lượng bác sĩ gia đình đang hoạt động tại cơ sở',
  })
  totalActiveDoctors!: number;
}

export class PublicFacilitiesResponseDto {
  @ApiProperty({ type: [PublicFacilityItemDto] })
  items!: PublicFacilityItemDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta!: PaginationMetaDto;
}
