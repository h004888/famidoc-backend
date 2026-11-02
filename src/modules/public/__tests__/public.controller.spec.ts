import { Test, TestingModule } from '@nestjs/testing';
import { PublicController } from '../controllers/public.controller';
import {
  IPublicService,
  PUBLIC_SERVICE_TOKEN,
} from '../services/interfaces/public.service.interface';
import { PortalOverviewResponseDto } from '../dtos/portal-overview-response.dto';
import {
  PackageSortBy,
  SearchPublicPackagesDto,
  SortOrder,
} from '../dtos/search-public-packages.dto';
import { PublicPackagesResponseDto } from '../dtos/public-packages-response.dto';

describe('PublicController', () => {
  let controller: PublicController;
  let service: jest.Mocked<IPublicService>;

  beforeEach(async () => {
    service = {
      getPublicPortalOverview: jest.fn(),
      searchPublicPackages: jest.fn(),
      getPublicPackageDetail: jest.fn(),
      lookupHealthcareFacilities: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PublicController],
      providers: [
        {
          provide: PUBLIC_SERVICE_TOKEN,
          useValue: service,
        },
      ],
    }).compile();

    controller = module.get<PublicController>(PublicController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getPublicPortalOverview', () => {
    it('should delegate to publicService.getPublicPortalOverview', async () => {
      const mockResult: PortalOverviewResponseDto = {
        platformInfo: {
          platformName: 'FamiDoc',
          slogan: 'Nền tảng Bác sĩ Gia đình Toàn diện',
          description: 'Mô tả',
          legalBasis: 'Luật Khám bệnh, chữa bệnh',
          securityStandards: 'ISO 27799',
        },
        heroBanners: [],
        corePillars: [],
        metrics: {
          totalPartnerFacilities: 10,
          totalDoctors: 20,
          totalActivePackages: 5,
          totalFamiliesServed: 100,
        },
        featuredFacilities: [],
        featuredPackages: [],
      };

      const overviewSpy = jest.spyOn(service, 'getPublicPortalOverview');
      overviewSpy.mockResolvedValue(mockResult);

      const result = await controller.getPublicPortalOverview();

      expect(result).toBe(mockResult);
      expect(overviewSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('searchPublicPackages', () => {
    it('should delegate to publicService.searchPublicPackages', async () => {
      const query: SearchPublicPackagesDto = {
        search: 'Tiêu chuẩn',
        durationMonths: 12,
        page: 1,
        limit: 10,
        sortBy: PackageSortBy.BASE_PRICE,
        sortOrder: SortOrder.ASC,
      };

      const mockResponse: PublicPackagesResponseDto = {
        items: [
          {
            id: 'pkg-1',
            packageCode: 'PKG-STANDARD',
            packageName: 'Gói Tiêu Chuẩn',
            durationMonths: 12,
            basePrice: 12000000,
            periodicVisitsQuota: 4,
            telehealthQuota: 12,
            maxMembers: 4,
            includedMembers: 4,
            additionalMemberMonthlyPrice: 200000,
            quotaPeriod: 'PER_TERM',
            description: 'Mô tả',
            publishedAt: new Date(),
          },
        ],
        meta: {
          total: 1,
          page: 1,
          limit: 10,
          totalPages: 1,
        },
      };

      const searchSpy = jest.spyOn(service, 'searchPublicPackages');
      searchSpy.mockResolvedValue(mockResponse);

      const result = await controller.searchPublicPackages(query);

      expect(result).toBe(mockResponse);
      expect(searchSpy).toHaveBeenCalledWith(query);
    });
  });

  describe('getPublicPackageDetail', () => {
    it('should delegate to publicService.getPublicPackageDetail', async () => {
      const mockDetail = {
        id: 'pkg-1',
        packageCode: 'PKG-STANDARD',
        packageName: 'Gói Tiêu Chuẩn',
        durationMonths: 12,
        basePrice: 12000000,
        periodicVisitsQuota: 4,
        telehealthQuota: 12,
        maxMembers: 4,
        includedMembers: 4,
        additionalMemberMonthlyPrice: 200000,
        quotaPeriod: 'PER_TERM',
        description: 'Mô tả',
        publishedAt: new Date(),
        benefits: {
          periodicVisitsQuota: 4,
          telehealthQuota: 12,
          clinicalServices: ['Khám định kỳ'],
          emergencySupport: 'Hotline 24/7',
        },
        sampleTerms: {
          rescheduleNoticeHours: '4 giờ',
          cancellationPolicy: 'Chính sách hủy',
          dataPrivacyPolicy: 'ISO 27799',
        },
      };

      const detailSpy = jest.spyOn(service, 'getPublicPackageDetail');
      detailSpy.mockResolvedValue(mockDetail as any);

      const result = await controller.getPublicPackageDetail('pkg-1');

      expect(result).toBe(mockDetail);
      expect(detailSpy).toHaveBeenCalledWith('pkg-1');
    });
  });

  describe('lookupHealthcareFacilities', () => {
    it('should delegate to publicService.lookupHealthcareFacilities', async () => {
      const query = {
        search: 'Hà Nội',
        page: 1,
        limit: 10,
      };

      const mockResponse = {
        items: [
          {
            id: 'fac-1',
            facilityName: 'Phòng khám Hà Nội',
            licenseNumber: 'GPHN-01',
            address: 'Hà Nội',
            hotline: '1900 6868',
            totalActiveDoctors: 5,
          },
        ],
        meta: {
          total: 1,
          page: 1,
          limit: 10,
          totalPages: 1,
        },
      };

      const facilitySpy = jest.spyOn(service, 'lookupHealthcareFacilities');
      facilitySpy.mockResolvedValue(mockResponse);

      const result = await controller.lookupHealthcareFacilities(query);

      expect(result).toBe(mockResponse);
      expect(facilitySpy).toHaveBeenCalledWith(query);
    });
  });
});

