import { ApiProperty } from '@nestjs/swagger';

export class PublicPackageItemDto {
  videoQuotaPolicy?: string;
  homeVisitUnitPriceVnd?: number;
  @ApiProperty({ example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  id!: string;

  @ApiProperty({ example: 'PKG-STANDARD' })
  packageCode!: string;

  @ApiProperty({ example: 'Gói Chăm Sóc Sức Khỏe Gia Đình Tiêu Chuẩn' })
  packageName!: string;

  @ApiProperty({ example: 12, description: 'Thời hạn gói (tháng)' })
  durationMonths!: number;

  @ApiProperty({ example: 12000000, description: 'Giá gốc niêm yết (VNĐ)' })
  basePrice!: number;

  @ApiProperty({ example: 4, description: 'Số lượt khám định kỳ tại nhà' })
  periodicVisitsQuota!: number;

  @ApiProperty({
    example: 12,
    description: 'Số lượt tư vấn từ xa (Telehealth)',
  })
  telehealthQuota!: number;

  @ApiProperty({ example: 4, description: 'Số thành viên tối đa áp dụng' })
  maxMembers!: number;

  @ApiProperty({ example: 4, description: 'Số thành viên cơ bản đã bao gồm' })
  includedMembers!: number;

  @ApiProperty({
    example: 200000,
    description: 'Đơn giá mỗi thành viên thêm mỗi tháng (VNĐ)',
  })
  additionalMemberMonthlyPrice!: number;

  @ApiProperty({ example: 'PER_TERM', description: 'Chu kỳ áp dụng hạn mức' })
  quotaPeriod!: string;

  @ApiProperty({
    example:
      'Gói chăm sóc toàn diện cho gia đình 4 người với 4 lần khám tại nhà và tư vấn từ xa không giới hạn trong giờ hành chính.',
  })
  description!: string;

  @ApiProperty({
    example: '2026-01-01T00:00:00.000Z',
    nullable: true,
  })
  publishedAt!: Date | null;
}

export class PaginationMetaDto {
  @ApiProperty({
    example: 25,
    description: 'Tổng số bản ghi thỏa mãn điều kiện',
  })
  total!: number;

  @ApiProperty({ example: 1, description: 'Trang hiện tại' })
  page!: number;

  @ApiProperty({ example: 10, description: 'Số bản ghi trên mỗi trang' })
  limit!: number;

  @ApiProperty({ example: 3, description: 'Tổng số trang' })
  totalPages!: number;
}

export class PublicPackagesResponseDto {
  @ApiProperty({ type: [PublicPackageItemDto] })
  items!: PublicPackageItemDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta!: PaginationMetaDto;
}
