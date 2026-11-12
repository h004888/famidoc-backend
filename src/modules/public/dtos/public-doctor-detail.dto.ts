import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class DoctorStatsDto {
  @ApiProperty({
    description: 'Số năm kinh nghiệm hành nghề lâm sàng',
    example: 24,
  })
  experienceYears: number;

  @ApiProperty({
    description: 'Điểm đánh giá trung bình từ hộ gia đình (thang điểm 5.0)',
    example: 4.96,
  })
  ratingAvg: number;

  @ApiProperty({
    description: 'Tổng số lượt đánh giá công khai',
    example: 384,
  })
  totalReviews: number;

  @ApiProperty({
    description: 'Tổng số ca khám / tư vấn đã hoàn thành',
    example: 2400,
  })
  consultationCount: number;
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
    example: [
      '3 lượt bác sĩ trực tiếp thăm khám tại nhà',
      '4 lượt tư vấn video Telehealth 24/7',
      'Bác sĩ phụ trách chính & lập phác đồ điều trị gia đình',
      'Hồ sơ bệnh án điện tử (EHR) lưu trữ trọn đời',
    ],
  })
  features?: string[];

  @ApiPropertyOptional({
    description: 'Đánh dấu gói được nhiều gia đình lựa chọn nhất',
    example: true,
  })
  popular?: boolean;
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

  @ApiProperty({
    description: 'Cơ sở y tế hoặc bệnh viện trực thuộc',
    example: 'Bệnh viện Đại học Y Dược TP.HCM',
  })
  hospital: string;

  @ApiProperty({
    description: 'Tỉnh / thành phố nơi bác sĩ hoạt động',
    example: 'TP. Hồ Chí Minh',
  })
  location: string;

  @ApiProperty({
    description: 'Trạng thái đã thẩm định chứng chỉ hành nghề và hồ sơ y tế',
    example: true,
  })
  isVerified: boolean;

  @ApiProperty({
    description: 'Khả năng tiếp nhận thêm hộ gia đình mới vào danh sách phụ trách',
    example: true,
  })
  isAvailable: boolean;

  @ApiPropertyOptional({
    description: 'Đường dẫn ảnh đại diện chuyên nghiệp của bác sĩ',
    example: '/images/medsev/home-one/doctor/1.jpg',
  })
  avatarUrl?: string | null;

  @ApiProperty({
    description: 'Số liệu thống kê năng lực và uy tín bác sĩ',
    type: DoctorStatsDto,
  })
  stats: DoctorStatsDto;

  @ApiProperty({
    description: 'Các hình thức dịch vụ khám chữa bệnh tiếp nhận',
    type: [String],
    example: ['home', 'telehealth', 'clinic'],
  })
  services: string[];

  @ApiProperty({
    description: 'Quá trình đào tạo, học vị và chứng chỉ chuyên môn',
    type: [String],
    example: [
      'Tiến sĩ Y khoa (Y học Gia đình & Nội khoa) - Đại học Paris Descartes (2008)',
      'Thạc sĩ Y khoa chuyên ngành Nội khoa - Đại học Y Dược TP.HCM (2002)',
      'Bác sĩ Đa khoa xuất sắc - Đại học Y Dược TP.HCM (1998)',
    ],
  })
  education: string[];

  @ApiPropertyOptional({
    description: 'Tiểu sử tóm tắt quá trình công tác và thế mạnh chuyên sâu',
    example:
      'Nguyên Phó Trưởng khoa Khám bệnh - Bệnh viện Đại học Y Dược TP.HCM. Hơn 24 năm kinh nghiệm thực hành lâm sàng...',
  })
  bio?: string | null;

  @ApiPropertyOptional({
    description: 'Khung giờ và lịch trực tiếp nhận tư vấn/thăm khám',
    example:
      'Thứ 2 - Thứ 7: 08:00 - 18:00 (Nhận khám tại nhà các buổi chiều và tư vấn trực tuyến 24/7)',
  })
  schedule?: string | null;

  @ApiProperty({
    description: 'Danh sách các gói chăm sóc sức khỏe gia đình khả dụng',
    type: [DoctorCarePackageItemDto],
  })
  carePackages: DoctorCarePackageItemDto[];
}
