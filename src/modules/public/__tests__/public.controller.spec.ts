import { Test, TestingModule } from '@nestjs/testing';
import { PublicController } from '../controllers/public.controller';
import {
  IPublicService,
  PUBLIC_SERVICE_TOKEN,
} from '../services/interfaces/public.service.interface';
import { PortalOverviewResponseDto } from '../dtos/portal-overview-response.dto';

describe('PublicController', () => {
  let controller: PublicController;
  let service: jest.Mocked<IPublicService>;

  beforeEach(async () => {
    service = {
      getPublicPortalOverview: jest.fn(),
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

      service.getPublicPortalOverview.mockResolvedValue(mockResult);

      const result = await controller.getPublicPortalOverview();

      expect(result).toBe(mockResult);
      expect(service.getPublicPortalOverview).toHaveBeenCalledTimes(1);
    });
  });
});
