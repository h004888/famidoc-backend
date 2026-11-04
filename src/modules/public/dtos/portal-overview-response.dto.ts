import { ApiProperty } from '@nestjs/swagger';

export class HeroBannerDto {
  @ApiProperty({ example: 'Bác Sĩ Gia Đình Cho Mọi Nhà' })
  title!: string;

  @ApiProperty({
    example:
      'Chăm sóc sức khỏe toàn diện, liên tục và tận tâm ngay tại tổ ấm của bạn.',
  })
  subtitle!: string;

  @ApiProperty({ example: 'Đăng Ký Tư Vấn Ngay' })
  ctaText!: string;

  @ApiProperty({ example: '/consultation-request' })
  ctaLink!: string;

  @ApiProperty({
    example: 'https://cdn.famidoc.vn/banners/hero-family-doctor.webp',
  })
  imageUrl!: string;

  @ApiProperty({ example: 'Chuẩn Bộ Y Tế' })
  badge!: string;
}

export class CorePillarDto {
  @ApiProperty({ example: '01' })
  order!: string;

  @ApiProperty({ example: 'Bác sĩ gia đình tận tâm' })
  title!: string;

  @ApiProperty({
    example:
      'Đội ngũ bác sĩ có chứng chỉ hành nghề (CCHN), đào tạo chuyên sâu về Y học gia đình.',
  })
  description!: string;

  @ApiProperty({ example: 'user-doctor' })
  icon!: string;
}

export class PortalMetricsDto {
  @ApiProperty({ example: 12, description: 'Tổng số cơ sở y tế đối tác' })
  totalPartnerFacilities!: number;

  @ApiProperty({ example: 45, description: 'Tổng số bác sĩ đang hoạt động' })
  totalDoctors!: number;

  @ApiProperty({ example: 6, description: 'Tổng số gói dịch vụ chăm sóc' })
  totalActivePackages!: number;

  @ApiProperty({
    example: 120,
    description: 'Tổng số hộ gia đình được chăm sóc',
  })
  totalFamiliesServed!: number;
}

export class FeaturedFacilityDto {
  @ApiProperty({ example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  id!: string;

  @ApiProperty({ example: 'Phòng khám Đa khoa Quốc tế FamiDoc Hà Nội' })
  facilityName!: string;

  @ApiProperty({ example: 'Số 10 Phố Huế, Quận Hai Bà Trưng, Hà Nội' })
  address!: string;

  @ApiProperty({ example: '1900 6868' })
  hotline!: string;
}

export class FeaturedPackageDto {
  @ApiProperty({ example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  id!: string;

  @ApiProperty({ example: 'PKG-STANDARD' })
  packageCode!: string;

  @ApiProperty({ example: 'Gói Chăm Sóc Sức Khỏe Gia Đình Tiêu Chuẩn' })
  packageName!: string;

  @ApiProperty({ example: 12 })
  durationMonths!: number;

  @ApiProperty({ example: 12000000 })
  basePrice!: number;

  @ApiProperty({ example: 4 })
  periodicVisitsQuota!: number;

  @ApiProperty({ example: 12 })
  telehealthQuota!: number;

  @ApiProperty({ example: 4 })
  maxMembers!: number;

  @ApiProperty({
    example:
      'Gói chăm sóc toàn diện cho gia đình 4 người với 4 lần khám tại nhà và tư vấn từ xa.',
  })
  description!: string;
}

export class PlatformInfoDto {
  @ApiProperty({ example: 'FamiDoc' })
  platformName!: string;

  @ApiProperty({ example: 'Nền tảng Bác sĩ Gia đình Toàn diện' })
  slogan!: string;

  @ApiProperty({
    example:
      'Chăm sóc sức khỏe y tế gia đình theo chuẩn Luật Khám bệnh, chữa bệnh 2023 và Nghị định 96/2023/NĐ-CP.',
  })
  description!: string;

  @ApiProperty({
    example:
      'Luật Khám bệnh, chữa bệnh số 15/2023/QH15, Nghị định 96/2023/NĐ-CP, Nghị định 13/2023/NĐ-CP',
  })
  legalBasis!: string;

  @ApiProperty({
    example:
      'ISO 27799:2016 (Bảo mật thông tin y tế), AES-256 GCM, TLS 1.3',
  })
  securityStandards!: string;
}

export class PortalOverviewResponseDto {
  @ApiProperty({ type: PlatformInfoDto })
  platformInfo!: PlatformInfoDto;

  @ApiProperty({ type: [HeroBannerDto] })
  heroBanners!: HeroBannerDto[];

  @ApiProperty({ type: [CorePillarDto] })
  corePillars!: CorePillarDto[];

  @ApiProperty({ type: PortalMetricsDto })
  metrics!: PortalMetricsDto;

  @ApiProperty({ type: [FeaturedFacilityDto] })
  featuredFacilities!: FeaturedFacilityDto[];

  @ApiProperty({ type: [FeaturedPackageDto] })
  featuredPackages!: FeaturedPackageDto[];
}
