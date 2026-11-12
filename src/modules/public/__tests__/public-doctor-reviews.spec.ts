import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PublicController } from '../controllers/public.controller';
import { PublicServiceImpl } from '../services/impl/public.service.impl';
import {
  IPublicService,
  PUBLIC_SERVICE_TOKEN,
} from '../services/interfaces/public.service.interface';
import { PrismaService } from '../../../core/database/prisma.service';

describe('PublicDoctorReviews (Task 2)', () => {
  describe('PublicServiceImpl.getDoctorReviews', () => {
    let service: PublicServiceImpl;
    let prisma: {
      doctor: { findUnique: jest.Mock };
      doctorReview: { count: jest.Mock; findMany: jest.Mock };
    };

    beforeEach(async () => {
      prisma = {
        doctor: { findUnique: jest.fn() },
        doctorReview: { count: jest.Mock ? jest.fn() : jest.fn(), findMany: jest.fn() },
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

    it('should return paginated doctor reviews with items and metadata', async () => {
      const mockDoctorId = '550e8400-e29b-41d4-a716-446655440000';

      prisma.doctor.findUnique.mockResolvedValue({
        id: mockDoctorId,
        onboardingStatus: 'ACTIVE',
      });

      const mockReviewsFromPrisma = [
        {
          id: 'review-1',
          ratingStars: 5,
          reviewComment: 'Bác sĩ rất tận tình và chu đáo.',
          createdAt: new Date('2026-11-01T10:00:00Z'),
          familyUnit: {
            homeAddress: '123 Nguyễn Thị Thập, Quận 7, TP.HCM',
            representativeUser: {
              fullName: 'Chị Mai Lan',
              avatarUrl: '/images/avatar-1.jpg',
            },
            medicalContracts: [
              {
                servicePackage: {
                  packageName: 'Gói Đồng Hành',
                },
              },
            ],
          },
        },
      ];

      prisma.doctorReview.count.mockResolvedValue(12);
      prisma.doctorReview.findMany.mockResolvedValue(mockReviewsFromPrisma);

      const result = await (service as any).getDoctorReviews(mockDoctorId, {
        page: 1,
        limit: 5,
      });

      expect(prisma.doctor.findUnique).toHaveBeenCalledWith({
        where: { id: mockDoctorId },
        select: expect.objectContaining({ id: true, onboardingStatus: true }),
      });

      expect(prisma.doctorReview.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ doctorId: mockDoctorId }),
          skip: 0,
          take: 5,
        }),
      );

      expect(result).toHaveProperty('items');
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        id: 'review-1',
        patientName: 'Chị Mai Lan',
        ratingStars: 5,
        comment: 'Bác sĩ rất tận tình và chu đáo.',
        packageName: 'Gói Đồng Hành',
      });

      expect(result).toHaveProperty('meta');
      expect(result.meta).toEqual({
        total: 12,
        page: 1,
        limit: 5,
        totalPages: 3,
      });
    });

    it('should throw NotFoundException if doctor does not exist', async () => {
      prisma.doctor.findUnique.mockResolvedValue(null);

      await expect(
        (service as any).getDoctorReviews('non-existent-id', { page: 1, limit: 5 }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('PublicController.getDoctorReviews', () => {
    let controller: PublicController;
    let service: jest.Mocked<any>;

    beforeEach(async () => {
      service = {
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

    it('should call publicService.getDoctorReviews with doctorId and query params', async () => {
      const mockResult = {
        items: [
          {
            id: 'rev-1',
            patientName: 'Anh Tuấn',
            ratingStars: 5,
            comment: 'Dịch vụ tuyệt vời',
            packageName: 'Gói An Tâm',
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

      service.getDoctorReviews.mockResolvedValue(mockResult);

      const result = await (controller as any).getDoctorReviews(
        '550e8400-e29b-41d4-a716-446655440000',
        { page: 1, limit: 5 },
      );

      expect(result).toBe(mockResult);
      expect(service.getDoctorReviews).toHaveBeenCalledWith(
        '550e8400-e29b-41d4-a716-446655440000',
        { page: 1, limit: 5 },
      );
    });
  });
});
