import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../../core/database/prisma.service';
import { IPublicService } from '../interfaces/public.service.interface';
import {
  PortalOverviewResponseDto,
  HeroBannerDto,
  CorePillarDto,
} from '../../dtos/portal-overview-response.dto';
import { SearchPublicPackagesDto } from '../../dtos/search-public-packages.dto';
import { PublicPackagesResponseDto } from '../../dtos/public-packages-response.dto';
import { PublicPackageDetailDto } from '../../dtos/public-package-detail.dto';
import { LookupHealthcareFacilitiesDto } from '../../dtos/lookup-facilities.dto';
import { PublicFacilitiesResponseDto } from '../../dtos/public-facilities-response.dto';
import { LookupDoctorDirectoryDto } from '../../dtos/lookup-doctors.dto';
import {
  PublicDoctorsResponseDto,
  PublicDoctorItemDto,
} from '../../dtos/public-doctors-response.dto';
import { SubmitConsultationRequestDto } from '../../dtos/submit-consultation-request.dto';
import { ConsultationRequestResponseDto } from '../../dtos/consultation-request-response.dto';

@Injectable()
export class PublicServiceImpl implements IPublicService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

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

  async searchPublicPackages(
    dto: SearchPublicPackagesDto,
  ): Promise<PublicPackagesResponseDto> {
    const page = Math.max(1, dto.page || 1);
    const limit = Math.min(50, Math.max(1, dto.limit || 10));
    const skip = (page - 1) * limit;

    const where: Record<string, any> = {
      status: 'ACTIVE',
      deletedAt: null,
    };

    if (dto.search?.trim()) {
      const keyword = dto.search.trim();
      where.OR = [
        { packageName: { contains: keyword, mode: 'insensitive' } },
        { packageCode: { contains: keyword, mode: 'insensitive' } },
        { description: { contains: keyword, mode: 'insensitive' } },
      ];
    }

    if (dto.durationMonths) {
      where.durationMonths = dto.durationMonths;
    }

    if (dto.minPrice !== undefined || dto.maxPrice !== undefined) {
      where.basePrice = {};
      if (dto.minPrice !== undefined) {
        where.basePrice.gte = dto.minPrice;
      }
      if (dto.maxPrice !== undefined) {
        where.basePrice.lte = dto.maxPrice;
      }
    }

    if (dto.maxMembers) {
      where.maxMembers = { gte: dto.maxMembers };
    }

    const orderBy = {
      [dto.sortBy || 'basePrice']: dto.sortOrder || 'asc',
    };

    const [total, packages] = await Promise.all([
      this.prisma.servicePackage.count({ where }),
      this.prisma.servicePackage.findMany({
        where,
        skip,
        take: limit,
        orderBy,
      }),
    ]);

    return {
      items: packages.map((pkg) => ({
        id: pkg.id,
        packageCode: pkg.packageCode,
        packageName: pkg.packageName,
        durationMonths: pkg.durationMonths,
        basePrice: Number(pkg.basePrice),
        periodicVisitsQuota: pkg.periodicVisitsQuota,
        telehealthQuota: pkg.telehealthQuota,
        videoQuotaPolicy: pkg.videoQuotaPolicy,
        homeVisitUnitPriceVnd: pkg.homeVisitUnitPrice
          ? Number(pkg.homeVisitUnitPrice)
          : undefined,
        maxMembers: pkg.maxMembers,
        includedMembers: pkg.includedMembers,
        additionalMemberMonthlyPrice: Number(pkg.additionalMemberMonthlyPrice),
        quotaPeriod: pkg.quotaPeriod,
        description: pkg.description,
        publishedAt: pkg.publishedAt,
      })),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  async getPublicPackageDetail(id: string): Promise<PublicPackageDetailDto> {
    const pkg = await this.prisma.servicePackage.findUnique({
      where: { id },
    });

    if (!pkg || pkg.status !== 'ACTIVE' || pkg.deletedAt !== null) {
      throw new NotFoundException('Không tìm thấy gói chăm sóc sức khỏe');
    }

    return {
      id: pkg.id,
      packageCode: pkg.packageCode,
      packageName: pkg.packageName,
      durationMonths: pkg.durationMonths,
      basePrice: Number(pkg.basePrice),
      periodicVisitsQuota: pkg.periodicVisitsQuota,
      telehealthQuota: pkg.telehealthQuota,
      videoQuotaPolicy: pkg.videoQuotaPolicy,
      homeVisitUnitPriceVnd: pkg.homeVisitUnitPrice
        ? Number(pkg.homeVisitUnitPrice)
        : undefined,
      maxMembers: pkg.maxMembers,
      includedMembers: pkg.includedMembers,
      additionalMemberMonthlyPrice: Number(pkg.additionalMemberMonthlyPrice),
      quotaPeriod: pkg.quotaPeriod,
      description: pkg.description,
      publishedAt: pkg.publishedAt,
      benefits: {
        periodicVisitsQuota: pkg.periodicVisitsQuota,
        telehealthQuota: pkg.telehealthQuota,
        clinicalServices: [
          'Khám lâm sàng tổng quát toàn diện định kỳ tại nhà',
          'Đo dấu hiệu sinh tồn chuẩn y tế (Huyết áp, Nhịp tim, SpO2, Thân nhiệt)',
          'Theo dõi chỉ số và tư vấn trong phạm vi chuyên môn; xét nghiệm ngoài gói',
          'Cập nhật và theo dõi Hồ sơ sức khỏe điện tử (EHR) liên tục',
          'Kê đơn thuốc điện tử chuẩn Thông tư 04/2022/TT-BYT',
        ],
        emergencySupport:
          'Theo lịch và giờ làm việc đã thống nhất; không phải dịch vụ cấp cứu 24/7',
      },
      sampleTerms: {
        rescheduleNoticeHours:
          'Chính sách đổi lịch hẹn: Thông báo trước tối thiểu 4 giờ (CFG-07) trước giờ khám dự kiến.',
        cancellationPolicy:
          'Chính sách chấm dứt hợp đồng: Được quyền yêu cầu hủy gói và hoàn tiền theo chính sách trọng tài và điều khoản hợp đồng dịch vụ y tế (UC-19, UC-38).',
        dataPrivacyPolicy:
          'Bảo mật y tế: Toàn bộ hồ sơ bệnh án điện tử và dữ liệu lâm sàng được bảo mật theo tiêu chuẩn ISO 27799:2016 và Nghị định 13/2023/NĐ-CP.',
      },
    };
  }

  async lookupHealthcareFacilities(
    dto: LookupHealthcareFacilitiesDto,
  ): Promise<PublicFacilitiesResponseDto> {
    const page = Math.max(1, dto.page || 1);
    const limit = Math.min(50, Math.max(1, dto.limit || 10));
    const skip = (page - 1) * limit;

    const where: Record<string, any> = {
      verificationStatus: 'ACTIVE',
    };

    if (dto.search?.trim()) {
      const keyword = dto.search.trim();
      where.OR = [
        { facilityName: { contains: keyword, mode: 'insensitive' } },
        { address: { contains: keyword, mode: 'insensitive' } },
      ];
    }

    const [total, facilities] = await Promise.all([
      this.prisma.healthcareFacility.count({ where }),
      this.prisma.healthcareFacility.findMany({
        where,
        skip,
        take: limit,
        select: {
          id: true,
          facilityName: true,
          licenseNumber: true,
          address: true,
          hotline: true,
          _count: {
            select: {
              doctors: {
                where: { onboardingStatus: 'ACTIVE' },
              },
            },
          },
        },
        orderBy: { facilityName: 'asc' },
      }),
    ]);

    return {
      items: facilities.map((fac) => ({
        id: fac.id,
        facilityName: fac.facilityName,
        licenseNumber: fac.licenseNumber,
        address: fac.address,
        hotline: fac.hotline,
        totalActiveDoctors: fac._count.doctors,
      })),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  async lookupDoctorDirectory(
    dto: LookupDoctorDirectoryDto,
  ): Promise<PublicDoctorsResponseDto> {
    const page = Math.max(1, dto.page || 1);
    const limit = Math.min(50, Math.max(1, dto.limit || 10));
    const skip = (page - 1) * limit;

    const where: Record<string, any> = {
      onboardingStatus: 'ACTIVE',
    };

    if (dto.search?.trim()) {
      const keyword = dto.search.trim();
      where.OR = [
        { doctorName: { contains: keyword, mode: 'insensitive' } },
        { specialty: { contains: keyword, mode: 'insensitive' } },
        { bio: { contains: keyword, mode: 'insensitive' } },
      ];
    }

    if (dto.facilityId) {
      where.facilityId = dto.facilityId;
    }

    if (dto.city?.trim()) {
      where.facility = {
        ...where.facility,
        address: { contains: dto.city.trim(), mode: 'insensitive' },
      };
    }

    if (dto.specialty?.trim()) {
      where.specialty = { contains: dto.specialty.trim(), mode: 'insensitive' };
    }

    if (dto.minExperienceYears !== undefined) {
      where.experienceYears = { gte: dto.minExperienceYears };
    }

    const orderBy = {
      [dto.sortBy || 'ratingAvg']: dto.sortOrder || 'desc',
    };

    const [total, doctors] = await Promise.all([
      this.prisma.doctor.count({ where }),
      this.prisma.doctor.findMany({
        where,
        skip,
        take: limit,
        select: {
          id: true,
          doctorName: true,
          specialty: true,
          academicTitle: true,
          experienceYears: true,
          bio: true,
          ratingAvg: true,
          totalReviews: true,
          activePanelCount: true,
          maxPanelCapacity: true,
          facility: {
            select: {
              id: true,
              facilityName: true,
              address: true,
              hotline: true,
            },
          },
          user: {
            select: {
              avatarUrl: true,
            },
          },
        },
        orderBy,
      }),
    ]);

    return {
      items: doctors.map((doc) => ({
        id: doc.id,
        doctorName: doc.doctorName,
        specialty: doc.specialty,
        academicTitle: doc.academicTitle,
        experienceYears: doc.experienceYears,
        bio: doc.bio,
        ratingAvg: Number(doc.ratingAvg),
        totalReviews: doc.totalReviews,
        isAvailable: doc.activePanelCount < doc.maxPanelCapacity,
        avatarUrl: (doc as any).user?.avatarUrl || null,
        facility: doc.facility,
      })),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  async getPublicFacilityDetail(id: string): Promise<any> {
    const facility = await this.prisma.healthcareFacility.findUnique({
      where: { id },
      select: {
        id: true,
        facilityName: true,
        licenseNumber: true,
        address: true,
        hotline: true,
        email: true,
        verificationStatus: true,
        operatingStatus: true,
        createdAt: true,
        _count: {
          select: {
            doctors: {
              where: { onboardingStatus: 'ACTIVE' },
            },
          },
        },
      },
    });

    if (!facility || facility.verificationStatus !== 'ACTIVE') {
      throw new NotFoundException(
        'Không tìm thấy cơ sở y tế hoặc cơ sở y tế chưa được kích hoạt',
      );
    }

    return {
      id: facility.id,
      facilityName: facility.facilityName,
      licenseNumber: facility.licenseNumber,
      address: facility.address,
      hotline: facility.hotline,
      email: facility.email,
      verificationStatus: facility.verificationStatus,
      operatingStatus: facility.operatingStatus,
      totalActiveDoctors: facility._count.doctors,
      createdAt: facility.createdAt,
    };
  }

  async getPublicDoctorDetail(id: string): Promise<PublicDoctorItemDto> {
    const doctor = await this.prisma.doctor.findUnique({
      where: { id },
      select: {
        id: true,
        doctorName: true,
        specialty: true,
        academicTitle: true,
        experienceYears: true,
        bio: true,
        ratingAvg: true,
        totalReviews: true,
        activePanelCount: true,
        maxPanelCapacity: true,
        onboardingStatus: true,
        facility: {
          select: {
            id: true,
            facilityName: true,
            address: true,
            hotline: true,
          },
        },
      },
    });

    if (!doctor || doctor.onboardingStatus !== 'ACTIVE') {
      throw new NotFoundException(
        'Không tìm thấy bác sĩ hoặc bác sĩ chưa được kích hoạt',
      );
    }

    return {
      id: doctor.id,
      doctorName: doctor.doctorName,
      specialty: doctor.specialty,
      academicTitle: doctor.academicTitle,
      experienceYears: doctor.experienceYears,
      bio: doctor.bio,
      ratingAvg: Number(doctor.ratingAvg),
      totalReviews: doctor.totalReviews,
      isAvailable: doctor.activePanelCount < doctor.maxPanelCapacity,
      facility: doctor.facility,
    };
  }

  async submitConsultationRequest(
    dto: SubmitConsultationRequestDto,
    clientIp?: string,
    userAgent?: string,
  ): Promise<ConsultationRequestResponseDto> {
    if (dto.preferredPackageId) {
      const pkg = await this.prisma.servicePackage.findUnique({
        where: { id: dto.preferredPackageId },
      });
      if (!pkg || pkg.status !== 'ACTIVE' || pkg.deletedAt !== null) {
        throw new BadRequestException(
          'Gói chăm sóc sức khỏe được chọn không hợp lệ hoặc đã ngừng áp dụng',
        );
      }
    }

    const timestampPart = Date.now().toString(36).toUpperCase();
    const randomPart = Math.random().toString(36).substring(2, 6).toUpperCase();
    const ticketId = `CRQ-${timestampPart}-${randomPart}`;
    const submittedAt = new Date();

    await this.prisma.auditLog.create({
      data: {
        action: 'CONSULTATION_REQUEST_SUBMITTED',
        resourceName: 'ConsultationRequest',
        resourceId: ticketId,
        clientIp: clientIp || '127.0.0.1',
        userAgent: userAgent || 'PublicPortal',
        timestamp: submittedAt,
      },
    });

    return {
      ticketId,
      status: 'RECEIVED',
      message:
        'Yêu cầu tư vấn của bạn đã được tiếp nhận thành công. Đội ngũ bác sĩ và nhân viên y tế FamiDoc sẽ liên hệ tư vấn trong thời gian sớm nhất.',
      submittedAt,
    };
  }
}
