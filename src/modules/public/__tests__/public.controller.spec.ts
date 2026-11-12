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
      lookupDoctorDirectory: jest.fn(),
      submitConsultationRequest: jest.fn(),
      getPublicFacilityDetail: jest.fn(),
      getPublicDoctorDetail: jest.fn(),
      getDoctorReviews: jest.fn(),
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

  describe('lookupDoctorDirectory', () => {
    it('should delegate to publicService.lookupDoctorDirectory', async () => {
      const query = {
        search: 'Nguyễn Văn A',
        page: 1,
        limit: 10,
      };

      const mockResponse = {
        items: [
          {
            id: 'doc-1',
            doctorName: 'BS. Nguyễn Văn A',
            specialty: 'Y học gia đình',
            academicTitle: 'ThS.BS',
            experienceYears: 10,
            bio: 'Tiểu sử',
            ratingAvg: 4.9,
            totalReviews: 30,
            isAvailable: true,
            facility: {
              id: 'fac-1',
              facilityName: 'Phòng khám Hà Nội',
              address: 'Hà Nội',
              hotline: '1900 6868',
            },
          },
        ],
        meta: {
          total: 1,
          page: 1,
          limit: 10,
          totalPages: 1,
        },
      };

      const doctorSpy = jest.spyOn(service, 'lookupDoctorDirectory');
      doctorSpy.mockResolvedValue(mockResponse as any);

      const result = await controller.lookupDoctorDirectory(query as any);

      expect(result).toBe(mockResponse);
      expect(doctorSpy).toHaveBeenCalledWith(query);
    });
  });

  describe('submitConsultationRequest', () => {
    it('should delegate to publicService.submitConsultationRequest with client IP and user agent', async () => {
      const dto = {
        fullName: 'Nguyễn Văn Minh',
        phone: '0912345678',
        email: 'minh.nguyen@famidoc.vn',
        healthNeeds: 'Cần bác sĩ thăm khám gia đình',
        familyMemberCount: 4,
      };

      const mockReq = {
        headers: {
          'x-forwarded-for': '203.0.113.195',
          'user-agent': 'Chrome/120.0',
        },
        socket: {
          remoteAddress: '127.0.0.1',
        },
      } as any;

      const mockResponse = {
        ticketId: 'CRQ-L9X4K2-A1B2',
        status: 'RECEIVED',
        message: 'Tiếp nhận thành công',
        submittedAt: new Date(),
      };

      const submitSpy = jest.spyOn(service, 'submitConsultationRequest');
      submitSpy.mockResolvedValue(mockResponse);

      const result = await controller.submitConsultationRequest(dto, mockReq);

      expect(result).toBe(mockResponse);
      expect(submitSpy).toHaveBeenCalledWith(
        dto,
        '203.0.113.195',
        'Chrome/120.0',
      );
    });
  });

  describe('getPublicFacilityDetail', () => {
    it('should delegate to publicService.getPublicFacilityDetail', async () => {
      const facilityId = 'fac-uuid-1';
      const mockFacility = {
        id: facilityId,
        facilityName: 'Bệnh viện Đa khoa Quốc tế',
        licenseNumber: 'LIC-12345',
        address: 'Hà Nội',
        hotline: '1900 6868',
        email: 'bv@gmail.com',
        verificationStatus: 'ACTIVE',
        operatingStatus: 'OPERATIONAL',
        totalActiveDoctors: 5,
        createdAt: new Date(),
      };

      const spy = jest.spyOn(service, 'getPublicFacilityDetail');
      spy.mockResolvedValue(mockFacility as any);

      const result = await controller.getPublicFacilityDetail(facilityId);

      expect(result).toBe(mockFacility);
      expect(spy).toHaveBeenCalledWith(facilityId);
    });
  });

  describe('getPublicDoctorDetail', () => {
    it('should delegate to publicService.getPublicDoctorDetail', async () => {
      const doctorId = 'doc-uuid-1';
      const mockDoctor = {
        id: doctorId,
        doctorName: 'BS. Trần Văn B',
        specialty: 'Nội tổng quát',
        academicTitle: 'BS.CKI',
        experienceYears: 8,
        bio: 'Tiểu sử bác sĩ',
        ratingAvg: 4.8,
        totalReviews: 25,
        isAvailable: true,
        facility: {
          id: 'fac-uuid-1',
          facilityName: 'Bệnh viện Đa khoa Quốc tế',
          address: 'Hà Nội',
          hotline: '1900 6868',
        },
      };

      const spy = jest.spyOn(service, 'getPublicDoctorDetail');
      spy.mockResolvedValue(mockDoctor as any);

      const result = await controller.getPublicDoctorDetail(doctorId);

      expect(result).toBe(mockDoctor);
      expect(spy).toHaveBeenCalledWith(doctorId);
    });
  });

  describe('getDoctorReviews', () => {
    it('should delegate to publicService.getDoctorReviews', async () => {
      const doctorId = 'doc-uuid-1';
      const query = { page: 1, limit: 5 };
      const mockReviews = {
        items: [
          {
            id: 'rev-1',
            patientName: 'Chị Lan',
            ratingStars: 5,
            comment: 'Tốt',
            createdAt: new Date(),
          },
        ],
        meta: {
          total: 1,
          page: 1,
          limit: 5,
          totalPages: 1,
        },
      };

      const spy = jest.spyOn(service, 'getDoctorReviews');
      spy.mockResolvedValue(mockReviews as any);

      const result = await controller.getDoctorReviews(doctorId, query);

      expect(result).toBe(mockReviews);
      expect(spy).toHaveBeenCalledWith(doctorId, query);
    });
  });
});
