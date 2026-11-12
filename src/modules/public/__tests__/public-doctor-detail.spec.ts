import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PublicController } from '../controllers/public.controller';
import { PublicServiceImpl } from '../services/impl/public.service.impl';
import {
  IPublicService,
  PUBLIC_SERVICE_TOKEN,
} from '../services/interfaces/public.service.interface';
import { PrismaService } from '../../../core/database/prisma.service';
import { PublicDoctorDetailDto } from '../dtos/public-doctor-detail.dto';

describe('PublicDoctorDetail (Task 1)', () => {
  describe('PublicServiceImpl.getPublicDoctorDetail', () => {
    let service: PublicServiceImpl;
    let prisma: {
      doctor: { findUnique: jest.Mock };
      servicePackage: { findMany: jest.Mock };
    };

    beforeEach(async () => {
      prisma = {
        doctor: { findUnique: jest.fn() },
        servicePackage: { findMany: jest.fn() },
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          PublicServiceImpl,
          {
            provide: PrismaService,
            useValue: prisma,
          },
        ],
      }).compile();

      service = module.get<PublicServiceImpl>(PublicServiceImpl);
    });

    it('should return doctor detail with all required fields including stats, education, services, schedule, and carePackages', async () => {
      const mockDoctorId = '550e8400-e29b-41d4-a716-446655440000';
      const mockDoctorFromPrisma = {
        id: mockDoctorId,
        doctorName: 'Nguyễn Văn Hoài',
        academicTitle: 'PGS. TS. Bác sĩ',
        specialty: 'Bác sĩ Gia đình & Nội Tổng Quát',
        experienceYears: 24,
        bio: 'Bác sĩ đầu ngành với hơn 24 năm kinh nghiệm...',
        ratingAvg: 4.96,
        totalReviews: 384,
        activePanelCount: 18,
        maxPanelCapacity: 30,
        onboardingStatus: 'ACTIVE',
        facility: {
          id: 'fac-1',
          facilityName: 'Bệnh viện Đại học Y Dược TP.HCM',
          address: '215 Hồng Bàng, Phường 11, Quận 5',
          provinceCity: 'TP. Hồ Chí Minh',
        },
        user: {
          avatarUrl: '/images/medsev/home-one/doctor/1.jpg',
        },
        credentials: [
          {
            credentialType: 'DEGREE',
            certificateNumber: 'TS-001892',
            issuingAuthority: 'Đại học Paris Descartes',
          },
        ],
        _count: {
          encounters: 2400,
          reviews: 384,
        },
      };

      const mockPackagesFromPrisma = [
        {
          id: 'pkg-1',
          packageCode: 'PKG-FAMILY-01',
          packageName: 'Gói Đồng Hành',
          durationMonths: 3,
          basePrice: 2850000,
          periodicVisitsQuota: 3,
          telehealthQuota: 4,
          description: 'Phù hợp gia đình 3-6 người',
        },
      ];

      prisma.doctor.findUnique.mockResolvedValue(mockDoctorFromPrisma);
      prisma.servicePackage.findMany.mockResolvedValue(mockPackagesFromPrisma);

      const result: PublicDoctorDetailDto =
        await service.getPublicDoctorDetail(mockDoctorId);

      expect(prisma.doctor.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mockDoctorId },
        }),
      );

      // Verify all specified fields exist
      expect(result).toHaveProperty('id', mockDoctorId);
      expect(result).toHaveProperty('doctorName', 'Nguyễn Văn Hoài');
      expect(result).toHaveProperty('academicTitle', 'PGS. TS. Bác sĩ');
      expect(result).toHaveProperty('specialty', 'Bác sĩ Gia đình & Nội Tổng Quát');
      expect(result).toHaveProperty('specialtyKey');
      expect(result).toHaveProperty('hospital', 'Bệnh viện Đại học Y Dược TP.HCM');
      expect(result).toHaveProperty('location');
      expect(result).toHaveProperty('isVerified', true);
      expect(result).toHaveProperty('isAvailable', true);
      expect(result).toHaveProperty('avatarUrl', '/images/medsev/home-one/doctor/1.jpg');
      expect(result).toHaveProperty('stats');
      expect(result.stats).toEqual({
        experienceYears: 24,
        ratingAvg: 4.96,
        totalReviews: 384,
        consultationCount: 2400,
      });
      expect(result).toHaveProperty('services');
      expect(Array.isArray(result.services)).toBe(true);
      expect(result).toHaveProperty('education');
      expect(Array.isArray(result.education)).toBe(true);
      expect(result).toHaveProperty('bio', mockDoctorFromPrisma.bio);
      expect(result).toHaveProperty('schedule');
      expect(result).toHaveProperty('carePackages');
      expect(Array.isArray(result.carePackages)).toBe(true);
      expect(result.carePackages.length).toBeGreaterThan(0);
      expect(result.carePackages[0]).toMatchObject({
        id: 'pkg-1',
        packageCode: 'PKG-FAMILY-01',
        packageName: 'Gói Đồng Hành',
        durationMonths: 3,
        basePrice: 2850000,
      });
    });

    it('should throw NotFoundException when doctor does not exist or is not active', async () => {
      prisma.doctor.findUnique.mockResolvedValue(null);

      await expect(
        service.getPublicDoctorDetail('non-existent-id'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('PublicController.getPublicDoctorDetail', () => {
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
      } as any;

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

    it('should delegate to publicService.getPublicDoctorDetail and return PublicDoctorDetailDto', async () => {
      const mockResult: any = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        doctorName: 'Nguyễn Văn Hoài',
        academicTitle: 'PGS. TS. Bác sĩ',
        specialty: 'Bác sĩ Gia đình & Nội Tổng Quát',
        specialtyKey: 'general',
        hospital: 'Bệnh viện Đại học Y Dược TP.HCM',
        location: 'TP. Hồ Chí Minh',
        isVerified: true,
        isAvailable: true,
        avatarUrl: '/images/doctor-1.jpg',
        stats: {
          experienceYears: 24,
          ratingAvg: 4.96,
          totalReviews: 384,
          consultationCount: 2400,
        },
        services: ['home', 'telehealth', 'clinic'],
        education: ['Đại học Y Dược TP.HCM'],
        bio: 'Mô tả',
        schedule: 'Thứ 2 - Thứ 7',
        carePackages: [],
      };

      service.getPublicDoctorDetail.mockResolvedValue(mockResult);

      const result = await controller.getPublicDoctorDetail(
        '550e8400-e29b-41d4-a716-446655440000',
      );

      expect(result).toBe(mockResult);
      expect(service.getPublicDoctorDetail).toHaveBeenCalledWith(
        '550e8400-e29b-41d4-a716-446655440000',
      );
    });
  });
});
