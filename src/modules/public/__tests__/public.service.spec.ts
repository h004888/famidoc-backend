import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PublicServiceImpl } from '../services/impl/public.service.impl';
import { PrismaService } from '../../../core/database/prisma.service';

describe('PublicServiceImpl', () => {
  let service: PublicServiceImpl;
  let prismaService: any;

  beforeEach(async () => {
    prismaService = {
      healthcareFacility: {
        count: jest.fn().mockResolvedValue(15),
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'facility-uuid-1',
            facilityName: 'Phòng khám Đa khoa Quốc tế FamiDoc',
            address: 'Số 10 Phố Huế, Hà Nội',
            hotline: '1900 6868',
          },
        ]),
      },
      doctor: {
        count: jest.fn().mockResolvedValue(50),
        findMany: jest.fn(),
      },
      servicePackage: {
        count: jest.fn().mockResolvedValue(8),
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'pkg-uuid-1',
            packageCode: 'PKG-BASIC',
            packageName: 'Gói Cơ Bản',
            durationMonths: 6,
            basePrice: '5000000',
            periodicVisitsQuota: 2,
            telehealthQuota: 6,
            maxMembers: 3,
            description: 'Gói cơ bản chăm sóc y tế gia đình',
          },
        ]),
        findUnique: jest.fn(),
      },
      familyUnit: {
        count: jest.fn().mockResolvedValue(150),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PublicServiceImpl,
        {
          provide: PrismaService,
          useValue: prismaService,
        },
      ],
    }).compile();

    service = module.get<PublicServiceImpl>(PublicServiceImpl);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getPublicPortalOverview', () => {
    it('should return platform overview with legal standards, metrics, and featured items', async () => {
      const result = await service.getPublicPortalOverview();

      expect(result).toBeDefined();
      expect(result.platformInfo.platformName).toBe('FamiDoc');
      expect(result.platformInfo.legalBasis).toContain('Luật Khám bệnh, chữa bệnh');
      expect(result.platformInfo.securityStandards).toContain('ISO 27799');

      expect(result.heroBanners.length).toBeGreaterThan(0);
      expect(result.corePillars.length).toBe(4);

      expect(result.metrics).toEqual({
        totalPartnerFacilities: 15,
        totalDoctors: 50,
        totalActivePackages: 8,
        totalFamiliesServed: 150,
      });

      expect(result.featuredFacilities).toHaveLength(1);
      expect(result.featuredFacilities[0].id).toBe('facility-uuid-1');

      expect(result.featuredPackages).toHaveLength(1);
      expect(result.featuredPackages[0].id).toBe('pkg-uuid-1');
      expect(result.featuredPackages[0].basePrice).toBe(5000000);
      expect(typeof result.featuredPackages[0].basePrice).toBe('number');

      expect(prismaService.healthcareFacility.count).toHaveBeenCalledWith({
        where: { verificationStatus: 'ACTIVE' },
      });
      expect(prismaService.doctor.count).toHaveBeenCalledWith({
        where: { onboardingStatus: 'ACTIVE' },
      });
      expect(prismaService.servicePackage.count).toHaveBeenCalledWith({
        where: { status: 'ACTIVE', deletedAt: null },
      });
      expect(prismaService.familyUnit.count).toHaveBeenCalledWith({
        where: { status: 'ACTIVE' },
      });
    });
  });

  describe('searchPublicPackages', () => {
    it('should search and return paginated packages with default parameters', async () => {
      const mockPackages = [
        {
          id: 'pkg-1',
          packageCode: 'PKG-STANDARD',
          packageName: 'Gói Tiêu Chuẩn',
          durationMonths: 12,
          basePrice: '12000000',
          periodicVisitsQuota: 4,
          telehealthQuota: 12,
          maxMembers: 4,
          includedMembers: 4,
          additionalMemberMonthlyPrice: '200000',
          quotaPeriod: 'PER_TERM',
          description: 'Gói chăm sóc tiêu chuẩn',
          publishedAt: new Date('2026-01-01'),
        },
      ];

      prismaService.servicePackage.count.mockResolvedValue(1);
      prismaService.servicePackage.findMany.mockResolvedValue(mockPackages);

      const result = await service.searchPublicPackages({
        page: 1,
        limit: 10,
        sortBy: 'basePrice' as any,
        sortOrder: 'asc' as any,
      });

      expect(result).toBeDefined();
      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('pkg-1');
      expect(result.items[0].basePrice).toBe(12000000);
      expect(result.items[0].additionalMemberMonthlyPrice).toBe(200000);
      expect(result.meta).toEqual({
        total: 1,
        page: 1,
        limit: 10,
        totalPages: 1,
      });

      expect(prismaService.servicePackage.findMany).toHaveBeenCalledWith({
        where: {
          status: 'ACTIVE',
          deletedAt: null,
        },
        skip: 0,
        take: 10,
        orderBy: { basePrice: 'asc' },
      });
    });

    it('should filter by search keyword, price range, durationMonths and maxMembers', async () => {
      prismaService.servicePackage.count.mockResolvedValue(0);
      prismaService.servicePackage.findMany.mockResolvedValue([]);

      await service.searchPublicPackages({
        search: 'Tiêu chuẩn',
        durationMonths: 12,
        minPrice: 5000000,
        maxPrice: 15000000,
        maxMembers: 4,
        page: 2,
        limit: 5,
        sortBy: 'packageName' as any,
        sortOrder: 'desc' as any,
      });

      expect(prismaService.servicePackage.findMany).toHaveBeenCalledWith({
        where: {
          status: 'ACTIVE',
          deletedAt: null,
          OR: [
            { packageName: { contains: 'Tiêu chuẩn', mode: 'insensitive' } },
            { packageCode: { contains: 'Tiêu chuẩn', mode: 'insensitive' } },
            { description: { contains: 'Tiêu chuẩn', mode: 'insensitive' } },
          ],
          durationMonths: 12,
          basePrice: {
            gte: 5000000,
            lte: 15000000,
          },
          maxMembers: {
            gte: 4,
          },
        },
        skip: 5,
        take: 5,
        orderBy: { packageName: 'desc' },
      });
    });
  });

  describe('getPublicPackageDetail', () => {
    const mockPackage = {
      id: 'pkg-uuid-detail',
      packageCode: 'PKG-PREMIUM',
      packageName: 'Gói Cao Cấp',
      durationMonths: 12,
      basePrice: '18000000',
      periodicVisitsQuota: 6,
      telehealthQuota: 24,
      maxMembers: 6,
      includedMembers: 4,
      additionalMemberMonthlyPrice: '250000',
      quotaPeriod: 'PER_TERM',
      status: 'ACTIVE',
      deletedAt: null,
      description: 'Gói chăm sóc y tế toàn diện cao cấp cho đại gia đình',
      publishedAt: new Date('2026-01-01'),
    };

    it('should return package detail with benefits and sample contract terms', async () => {
      prismaService.servicePackage.findUnique.mockResolvedValue(mockPackage);

      const result = await service.getPublicPackageDetail('pkg-uuid-detail');

      expect(result).toBeDefined();
      expect(result.id).toBe('pkg-uuid-detail');
      expect(result.basePrice).toBe(18000000);
      expect(typeof result.basePrice).toBe('number');
      expect(result.benefits.periodicVisitsQuota).toBe(6);
      expect(result.benefits.telehealthQuota).toBe(24);
      expect(result.benefits.clinicalServices.length).toBeGreaterThan(0);
      expect(result.benefits.emergencySupport).toBeDefined();
      expect(result.sampleTerms.rescheduleNoticeHours).toContain('4 giờ');
      expect(result.sampleTerms.cancellationPolicy).toBeDefined();
      expect(result.sampleTerms.dataPrivacyPolicy).toContain('ISO 27799');

      expect(prismaService.servicePackage.findUnique).toHaveBeenCalledWith({
        where: { id: 'pkg-uuid-detail' },
      });
    });

    it('should throw NotFoundException if package does not exist', async () => {
      prismaService.servicePackage.findUnique.mockResolvedValue(null);

      await expect(
        service.getPublicPackageDetail('non-existing-id'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException if package is not ACTIVE', async () => {
      prismaService.servicePackage.findUnique.mockResolvedValue({
        ...mockPackage,
        status: 'DRAFT',
      });

      await expect(
        service.getPublicPackageDetail('pkg-uuid-detail'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException if package is deleted', async () => {
      prismaService.servicePackage.findUnique.mockResolvedValue({
        ...mockPackage,
        deletedAt: new Date(),
      });

      await expect(
        service.getPublicPackageDetail('pkg-uuid-detail'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('lookupHealthcareFacilities', () => {
    it('should return paginated active facilities with totalActiveDoctors count', async () => {
      const mockFacilities = [
        {
          id: 'fac-1',
          facilityName: 'Phòng khám Đa khoa FamiDoc Hà Nội',
          licenseNumber: 'GPHN-01',
          address: '10 Phố Huế, Hà Nội',
          hotline: '1900 6868',
          _count: { doctors: 5 },
        },
      ];

      prismaService.healthcareFacility.count.mockResolvedValue(1);
      prismaService.healthcareFacility.findMany.mockResolvedValue(mockFacilities);

      const result = await service.lookupHealthcareFacilities({
        page: 1,
        limit: 10,
      });

      expect(result).toBeDefined();
      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('fac-1');
      expect(result.items[0].totalActiveDoctors).toBe(5);
      expect(result.meta).toEqual({
        total: 1,
        page: 1,
        limit: 10,
        totalPages: 1,
      });

      expect(prismaService.healthcareFacility.findMany).toHaveBeenCalledWith({
        where: { verificationStatus: 'ACTIVE' },
        skip: 0,
        take: 10,
        select: expect.objectContaining({
          id: true,
          facilityName: true,
          licenseNumber: true,
          address: true,
          hotline: true,
          _count: expect.any(Object),
        }),
        orderBy: { facilityName: 'asc' },
      });
    });

    it('should filter facilities by search keyword in facilityName or address', async () => {
      prismaService.healthcareFacility.count.mockResolvedValue(0);
      prismaService.healthcareFacility.findMany.mockResolvedValue([]);

      await service.lookupHealthcareFacilities({
        search: 'Hà Nội',
        page: 2,
        limit: 5,
      });

      expect(prismaService.healthcareFacility.findMany).toHaveBeenCalledWith({
        where: {
          verificationStatus: 'ACTIVE',
          OR: [
            { facilityName: { contains: 'Hà Nội', mode: 'insensitive' } },
            { address: { contains: 'Hà Nội', mode: 'insensitive' } },
          ],
        },
        skip: 5,
        take: 5,
        select: expect.any(Object),
        orderBy: { facilityName: 'asc' },
      });
    });
  });

  describe('lookupDoctorDirectory', () => {
    it('should return paginated active doctors with calculated availability', async () => {
      const mockDoctors = [
        {
          id: 'doc-1',
          doctorName: 'BS. CKI Nguyễn Văn A',
          specialty: 'Y học gia đình',
          academicTitle: 'ThS.BS',
          experienceYears: 10,
          bio: 'Chuyên gia Y học gia đình',
          ratingAvg: '4.90',
          totalReviews: 30,
          activePanelCount: 20,
          maxPanelCapacity: 30,
          facility: {
            id: 'fac-1',
            facilityName: 'Phòng khám Hà Nội',
            address: 'Hà Nội',
            hotline: '1900 6868',
          },
        },
      ];

      prismaService.doctor.count.mockResolvedValue(1);
      prismaService.doctor.findMany.mockResolvedValue(mockDoctors);

      const result = await service.lookupDoctorDirectory({
        page: 1,
        limit: 10,
      });

      expect(result).toBeDefined();
      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('doc-1');
      expect(result.items[0].ratingAvg).toBe(4.9);
      expect(typeof result.items[0].ratingAvg).toBe('number');
      expect(result.items[0].isAvailable).toBe(true);
      expect(result.items[0].facility.facilityName).toBe('Phòng khám Hà Nội');

      expect(prismaService.doctor.findMany).toHaveBeenCalledWith({
        where: { onboardingStatus: 'ACTIVE' },
        skip: 0,
        take: 10,
        select: expect.any(Object),
        orderBy: { ratingAvg: 'desc' },
      });
    });

    it('should filter doctors by search, specialty, facilityId and minExperienceYears', async () => {
      prismaService.doctor.count.mockResolvedValue(0);
      prismaService.doctor.findMany.mockResolvedValue([]);

      await service.lookupDoctorDirectory({
        search: 'Nguyễn',
        specialty: 'Y học gia đình',
        facilityId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
        minExperienceYears: 5,
        page: 2,
        limit: 5,
      });

      expect(prismaService.doctor.findMany).toHaveBeenCalledWith({
        where: {
          onboardingStatus: 'ACTIVE',
          OR: [
            { doctorName: { contains: 'Nguyễn', mode: 'insensitive' } },
            { specialty: { contains: 'Nguyễn', mode: 'insensitive' } },
            { bio: { contains: 'Nguyễn', mode: 'insensitive' } },
          ],
          specialty: { contains: 'Y học gia đình', mode: 'insensitive' },
          facilityId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
          experienceYears: { gte: 5 },
        },
        skip: 5,
        take: 5,
        select: expect.any(Object),
        orderBy: { ratingAvg: 'desc' },
      });
    });
  });
});
