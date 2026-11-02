import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../core/database/prisma.service';
import { IPublicService } from '../interfaces/public.service.interface';
import {
  PortalOverviewResponseDto,
  HeroBannerDto,
  CorePillarDto,
} from '../../dtos/portal-overview-response.dto';

@Injectable()
export class PublicServiceImpl implements IPublicService {
  constructor(private readonly prisma: PrismaService) {}

  async getPublicPortalOverview(): Promise<PortalOverviewResponseDto> {
    const [
      totalFacilities,
      totalDoctors,
      totalPackages,
      totalFamilies,
      facilities,
      packages,
    ] = await Promise.all([
      this.prisma.healthcareFacility.count({
        where: { verificationStatus: 'ACTIVE' },
      }),
      this.prisma.doctor.count({
        where: { onboardingStatus: 'ACTIVE' },
      }),
      this.prisma.servicePackage.count({
        where: { status: 'ACTIVE', deletedAt: null },
      }),
      this.prisma.familyUnit.count({
        where: { status: 'ACTIVE' },
      }),
      this.prisma.healthcareFacility.findMany({
        where: { verificationStatus: 'ACTIVE' },
        take: 4,
        select: {
          id: true,
          facilityName: true,
          address: true,
          hotline: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.servicePackage.findMany({
        where: { status: 'ACTIVE', deletedAt: null },
        take: 4,
        select: {
          id: true,
          packageCode: true,
          packageName: true,
          durationMonths: true,
          basePrice: true,
          periodicVisitsQuota: true,
          telehealthQuota: true,
          maxMembers: true,
          description: true,
        },
        orderBy: { basePrice: 'asc' },
      }),
    ]);

    const heroBanners: HeroBannerDto[] = [
      {
        title: 'Bác Sĩ Gia Đình Cho Mọi Nhà',
        subtitle:
          'Chăm sóc sức khỏe toàn diện, liên tục và tận tâm ngay tại tổ ấm của bạn theo chuẩn Bộ Y tế.',
        ctaText: 'Đăng Ký Tư Vấn Ngay',
        ctaLink: '/consultation-request',
        imageUrl: 'https://cdn.famidoc.vn/banners/hero-family-doctor.webp',
        badge: 'Chuẩn Bộ Y Tế',
      },
      {
        title: 'Hồ Sơ Sức Khỏe Điện Tử Trọn Đời',
        subtitle:
          'Dữ liệu y tế bảo mật chuẩn ISO 27799, lưu trữ lịch sử thăm khám và đơn thuốc điện tử an toàn.',
        ctaText: 'Khám Phá Gói Dịch Vụ',
        ctaLink: '/packages',
        imageUrl: 'https://cdn.famidoc.vn/banners/hero-ehr.webp',
        badge: 'Bảo Mật ISO 27799',
      },
    ];

    const corePillars: CorePillarDto[] = [
      {
        order: '01',
        title: 'Bác sĩ gia đình tận tâm',
        description:
          'Bác sĩ có chứng chỉ hành nghề (CCHN), đào tạo bài bản về Y học gia đình và quản lý sức khỏe ngoại trú.',
        icon: 'user-doctor',
      },
      {
        order: '02',
        title: 'Hồ sơ sức khỏe điện tử (EHR)',
        description:
          'Theo dõi diễn tiến sức khỏe liên tục, cảnh báo tiền sử dị ứng và lưu vết lâm sàng bảo mật trọn đời.',
        icon: 'file-medical',
      },
      {
        order: '03',
        title: 'Thăm khám tại nhà & Telehealth',
        description:
          'Kết hợp khám trực tiếp định kỳ tại nhà và tư vấn trực tuyến từ xa qua video mã hóa theo chuẩn bảo mật.',
        icon: 'video-camera',
      },
      {
        order: '04',
        title: 'Mạng lưới y tế đối tác chất lượng',
        description:
          'Liên kết chặt chẽ với các bệnh viện, phòng khám đa khoa uy tín để chuyển tuyến chuyên sâu thuận tiện.',
        icon: 'hospital',
      },
    ];

    return {
      platformInfo: {
        platformName: 'FamiDoc',
        slogan: 'Nền tảng Bác sĩ Gia đình Toàn diện',
        description:
          'Chăm sóc sức khỏe y tế gia đình theo chuẩn Luật Khám bệnh, chữa bệnh 2023 và Nghị định 96/2023/NĐ-CP.',
        legalBasis:
          'Luật Khám bệnh, chữa bệnh số 15/2023/QH15, Nghị định 96/2023/NĐ-CP, Nghị định 13/2023/NĐ-CP',
        securityStandards:
          'ISO 27799:2016 (Bảo mật thông tin y tế), AES-256 GCM, TLS 1.3',
      },
      heroBanners,
      corePillars,
      metrics: {
        totalPartnerFacilities: totalFacilities,
        totalDoctors: totalDoctors,
        totalActivePackages: totalPackages,
        totalFamiliesServed: totalFamilies,
      },
      featuredFacilities: facilities,
      featuredPackages: packages.map((pkg) => ({
        ...pkg,
        basePrice: Number(pkg.basePrice),
      })),
    };
  }
}
