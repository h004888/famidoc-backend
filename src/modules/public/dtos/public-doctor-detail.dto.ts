import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class DoctorStatsDto {
  @ApiProperty({
    description: 'Số năm kinh nghiệm hành nghề lâm sàng',
    example: 24,
  })
  experienceYears: number;

  @ApiPropertyOptional({
    description:
      'Điểm đánh giá trung bình (thang điểm 5.0); null khi bác sĩ chưa có đánh giá',
    example: 4.96,
    nullable: true,
  })
  ratingAvg: number | null;

  @ApiProperty({
    description: 'Tổng số lượt đánh giá công khai',
    example: 384,
  })
  totalReviews: number;

  @ApiProperty({
    description: 'Tổng số buổi khám đã hoàn tất',
    example: 2400,
  })
  completedEncounters: number;
}

export class DoctorPanelDto {
  @ApiProperty({
    description: 'Số hộ gia đình bác sĩ đang phụ trách',
    example: 18,
  })
  activeCount: number;

  @ApiProperty({
    description: 'Số hộ gia đình tối đa bác sĩ có thể phụ trách',
    example: 30,
  })
  maxCapacity: number;
}

export class PublicFacilitySummaryDto {
  @ApiProperty({ description: 'UUID của cơ sở y tế' })
  id: string;

  @ApiProperty({
    description: 'Tên cơ sở y tế',
    example: 'Bệnh viện Đại học Y Dược TP.HCM',
  })
  facilityName: string;

  @ApiProperty({
    description: 'Địa chỉ cơ sở y tế',
    example: '215 Hồng Bàng, Phường 11, Quận 5, TP. Hồ Chí Minh',
  })
  address: string;

  @ApiProperty({
    description: 'Trạng thái xác thực của cơ sở y tế',
    example: 'ACTIVE',
  })
  verificationStatus: string;
}

export class DoctorCredentialItemDto {
  @ApiProperty({ description: 'UUID của chứng chỉ' })
  id: string;

  @ApiProperty({
    description: 'Loại chứng chỉ',
    example: 'PRACTICE_LICENSE_CCHN',
    enum: ['PRACTICE_LICENSE_CCHN', 'FAMILY_MEDICINE_CERT', 'DEGREE'],
  })
  type: string;

  @ApiProperty({
    description: 'Tên hiển thị của loại chứng chỉ',
    example: 'Chứng chỉ hành nghề',
  })
  typeLabel: string;

  @ApiProperty({
    description: 'Đơn vị cấp chứng chỉ',
    example: 'Sở Y tế TP. Hồ Chí Minh',
  })
  issuingAuthority: string;

  @ApiProperty({
    description: 'Năm cấp chứng chỉ',
    example: 2018,
  })
  issueYear: number;

  @ApiProperty({
    description: 'Chứng chỉ đã được nền tảng xác thực',
    example: true,
  })
  verified: boolean;
}

export class DoctorTreatedCaseItemDto {
  @ApiProperty({ description: 'UUID của ca bệnh tiêu biểu' })
  id: string;

  @ApiProperty({
    description: 'Mô tả ca bệnh đã được duyệt công khai',
    example:
      'Quản lý tăng huyết áp kháng trị cho bệnh nhân 72 tuổi kèm suy tim độ II.',
  })
  summary: string;
}

export class CareModelItemDto {
  @ApiProperty({ description: 'UUID của mục nội dung chăm sóc' })
  id: string;

  @ApiProperty({
    description: 'Nhóm nội dung',
    example: 'SERVICE_MODE',
    enum: ['SERVICE_MODE', 'COMMITMENT'],
  })
  category: string;

  @ApiProperty({ description: 'Tiêu đề hiển thị', example: 'Khám tận nhà' })
  title: string;

  @ApiProperty({
    description: 'Mô tả chi tiết',
    example: 'Khám lâm sàng tại nhà, đo điện tim ECG và theo dõi định kỳ.',
  })
  description: string;

  @ApiPropertyOptional({
    description: 'Biểu tượng hiển thị',
    example: 'home',
    nullable: true,
  })
  icon?: string | null;

  @ApiProperty({ description: 'Thứ tự hiển thị', example: 1 })
  sortOrder: number;
}

export class DoctorCareModelDto {
  @ApiProperty({
    description: 'Các hình thức khám đang áp dụng',
    type: [CareModelItemDto],
  })
  serviceModes: CareModelItemDto[];

  @ApiProperty({
    description: 'Các cam kết dịch vụ chung của nền tảng',
    type: [CareModelItemDto],
  })
  commitments: CareModelItemDto[];
}

export class DoctorCarePackageItemDto {
  @ApiProperty({
    description: 'Mã định danh duy nhất (UUID) của gói chăm sóc',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  id: string;

  @ApiProperty({
    description: 'Mã ký hiệu gói dịch vụ',
    example: 'PKG-FAMILY-01',
  })
  packageCode: string;

  @ApiProperty({
    description: 'Tên thương mại của gói chăm sóc sức khỏe',
    example: 'Gói Đồng Hành',
  })
  packageName: string;

  @ApiProperty({
    description: 'Thời hạn gói tính theo tháng',
    example: 3,
  })
  durationMonths: number;

  @ApiProperty({
    description: 'Đơn giá niêm yết của gói (VND)',
    example: 2850000,
  })
  basePrice: number;

  @ApiPropertyOptional({
    description: 'Đơn giá đã được định dạng chuỗi hiển thị',
    example: '2.850.000đ',
  })
  formattedPrice?: string;

  @ApiPropertyOptional({
    description: 'Đơn giá chia trung bình mỗi tháng',
    example: '950.000đ/tháng',
  })
  monthlyPrice?: string;

  @ApiProperty({
    description: 'Hạn mức lượt bác sĩ đến khám trực tiếp tại nhà',
    example: 3,
  })
  periodicVisitsQuota: number;

  @ApiProperty({
    description: 'Hạn mức lượt tư vấn trực tuyến Telehealth 24/7',
    example: 4,
  })
  telehealthQuota: number;

  @ApiPropertyOptional({
    description: 'Điểm nhấn hoặc đối tượng áp dụng tiêu biểu',
    example: 'Phù hợp gia đình có trẻ nhỏ & người lớn tuổi (3-6 người)',
  })
  highlight?: string;

  @ApiPropertyOptional({
    description: 'Danh sách các quyền lợi chính kèm theo gói',
    type: [String],
  })
  features?: string[];

  @ApiProperty({
    description: 'Số thành viên được bao gồm trong giá gói',
    example: 3,
  })
  includedMembers: number;

  @ApiProperty({
    description: 'Số thành viên tối đa của gói (gồm cả thành viên thêm)',
    example: 6,
  })
  maxMembers: number;

  @ApiProperty({
    description: 'Phụ phí mỗi thành viên thêm mỗi tháng (VND)',
    example: 75000,
  })
  additionalMemberMonthlyPrice: number;
}

export class PublicDoctorReviewPreviewItemDto {
  @ApiProperty({ description: 'UUID của đánh giá' })
  id: string;

  @ApiProperty({
    description: 'Tên người đánh giá đã được ẩn danh một phần',
    example: 'Nguyễn V. A.',
  })
  patientDisplayName: string;

  @ApiProperty({ description: 'Số sao đánh giá', example: 5 })
  ratingStars: number;

  @ApiPropertyOptional({
    description: 'Nội dung nhận xét',
    example: 'Bác sĩ rất tận tâm và giải thích chi tiết phác đồ.',
    nullable: true,
  })
  comment?: string | null;

  @ApiPropertyOptional({
    description: 'Tên gói tại buổi khám được đánh giá',
    example: 'Gói Đồng Hành',
    nullable: true,
  })
  packageName?: string | null;

  @ApiPropertyOptional({
    description: 'Quận/huyện của hộ gia đình',
    example: 'Quận 7',
    nullable: true,
  })
  district?: string | null;

  @ApiProperty({
    description: 'Thời điểm gửi đánh giá',
    example: '2026-11-01T08:30:00.000Z',
  })
  reviewedAt: Date | string;
}

export class PublicDoctorReviewsSummaryDto {
  @ApiProperty({
    description: 'Điểm đánh giá trung bình; null khi chưa có đánh giá',
    example: 4.96,
    nullable: true,
  })
  ratingAvg: number | null;

  @ApiProperty({ description: 'Tổng số đánh giá', example: 384 })
  totalReviews: number;

  @ApiProperty({
    description: 'Tối đa 5 đánh giá mới nhất có nội dung',
    type: [PublicDoctorReviewPreviewItemDto],
  })
  items: PublicDoctorReviewPreviewItemDto[];
}

export class PublicDoctorDetailDto {
  @ApiProperty({
    description: 'UUID duy nhất của bác sĩ gia đình',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  id: string;

  @ApiProperty({
    description: 'Họ và tên đầy đủ của bác sĩ',
    example: 'Nguyễn Văn Hoài',
  })
  doctorName: string;

  @ApiPropertyOptional({
    description: 'Học hàm, học vị chuyên môn',
    example: 'PGS. TS. Bác sĩ',
    nullable: true,
  })
  academicTitle?: string | null;

  @ApiProperty({
    description: 'Chuyên khoa phụ trách chính',
    example: 'Bác sĩ Gia đình & Nội Tổng Quát',
  })
  specialty: string;

  @ApiProperty({
    description: 'Mã định danh chuyên khoa rút gọn (slug/key)',
    example: 'general',
  })
  specialtyKey: string;

  @ApiPropertyOptional({
    description: 'Đường dẫn ảnh đại diện chuyên nghiệp của bác sĩ',
    example: '/images/medsev/home-one/doctor/1.jpg',
    nullable: true,
  })
  avatarUrl?: string | null;

  @ApiPropertyOptional({
    description: 'Tiểu sử tóm tắt quá trình công tác và thế mạnh chuyên sâu',
    example:
      'Nguyên Phó Trưởng khoa Khám bệnh - Bệnh viện Đại học Y Dược TP.HCM.',
    nullable: true,
  })
  bio?: string | null;

  @ApiProperty({
    description: 'Hồ sơ đã được nền tảng xác thực',
    example: true,
  })
  isVerified: boolean;

  @ApiProperty({
    description: 'Khả năng tiếp nhận thêm hộ gia đình mới',
    example: true,
  })
  isAvailable: boolean;

  @ApiProperty({
    description: 'Thông tin sức chứa hộ gia đình của bác sĩ',
    type: DoctorPanelDto,
  })
  panel: DoctorPanelDto;

  @ApiProperty({
    description: 'Số liệu thống kê năng lực và uy tín bác sĩ',
    type: DoctorStatsDto,
  })
  stats: DoctorStatsDto;

  @ApiPropertyOptional({
    description: 'Thông tin công khai của cơ sở y tế trực thuộc',
    type: PublicFacilitySummaryDto,
    nullable: true,
  })
  facility: PublicFacilitySummaryDto | null;

  @ApiProperty({
    description: 'Chứng chỉ đã được nền tảng xác thực',
    type: [DoctorCredentialItemDto],
  })
  credentials: DoctorCredentialItemDto[];

  @ApiProperty({
    description: 'Ca bệnh tiêu biểu đã được duyệt công khai',
    type: [DoctorTreatedCaseItemDto],
  })
  treatedCases: DoctorTreatedCaseItemDto[];

  @ApiProperty({
    description: 'Phạm vi chăm sóc chung của nền tảng',
    type: DoctorCareModelDto,
  })
  careModel: DoctorCareModelDto;

  @ApiProperty({
    description: 'Danh sách các gói chăm sóc sức khỏe gia đình khả dụng',
    type: [DoctorCarePackageItemDto],
  })
  carePackages: DoctorCarePackageItemDto[];

  @ApiProperty({
    description: 'Tóm tắt và các đánh giá đã xác thực mới nhất',
    type: PublicDoctorReviewsSummaryDto,
  })
  reviews: PublicDoctorReviewsSummaryDto;
}
