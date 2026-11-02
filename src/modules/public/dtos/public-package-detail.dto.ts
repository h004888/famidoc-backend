import { ApiProperty } from '@nestjs/swagger';
import { PublicPackageItemDto } from './public-packages-response.dto';

export class PackageBenefitDto {
  @ApiProperty({
    example: 4,
    description: 'Số lượt bác sĩ khám trực tiếp định kỳ tại nhà',
  })
  periodicVisitsQuota!: number;

  @ApiProperty({
    example: 12,
    description: 'Số lượt tư vấn trực tuyến (Telehealth) mã hóa',
  })
  telehealthQuota!: number;

  @ApiProperty({
    example: [
      'Khám lâm sàng tổng quát toàn diện định kỳ tại nhà',
      'Đo dấu hiệu sinh tồn chuẩn y tế (Huyết áp, Nhịp tim, SpO2, Thân nhiệt)',
      'Xét nghiệm đường huyết mao mạch và kiểm tra sức khỏe tại chỗ',
      'Cập nhật và theo dõi Hồ sơ sức khỏe điện tử (EHR) liên tục',
      'Kê đơn thuốc điện tử chuẩn Thông tư 04/2022/TT-BYT',
    ],
  })
  clinicalServices!: string[];

  @ApiProperty({ example: 'Đường dây nóng hỗ trợ điều phối y tế gia đình 24/7' })
  emergencySupport!: string;
}

export class SampleContractTermsDto {
  @ApiProperty({
    example:
      'Chính sách đổi lịch hẹn: Thông báo trước tối thiểu 4 giờ (CFG-07) trước giờ khám dự kiến.',
  })
  rescheduleNoticeHours!: string;

  @ApiProperty({
    example:
      'Chính sách chấm dứt hợp đồng: Được quyền yêu cầu hủy gói và hoàn tiền theo chính sách trọng tài và điều khoản hợp đồng dịch vụ y tế (UC-19, UC-38).',
  })
  cancellationPolicy!: string;

  @ApiProperty({
    example:
      'Bảo mật y tế: Toàn bộ hồ sơ bệnh án điện tử và dữ liệu lâm sàng được bảo mật theo tiêu chuẩn ISO 27799:2016 và Nghị định 13/2023/NĐ-CP.',
  })
  dataPrivacyPolicy!: string;
}

export class PublicPackageDetailDto extends PublicPackageItemDto {
  @ApiProperty({ type: PackageBenefitDto })
  benefits!: PackageBenefitDto;

  @ApiProperty({ type: SampleContractTermsDto })
  sampleTerms!: SampleContractTermsDto;
}
