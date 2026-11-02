import { Test, TestingModule } from '@nestjs/testing';
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
});
