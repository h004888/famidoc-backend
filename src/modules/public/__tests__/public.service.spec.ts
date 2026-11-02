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
});
