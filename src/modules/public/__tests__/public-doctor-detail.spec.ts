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

describe('PublicDoctorDetail (real data contract)', () => {
  const doctorId = '550e8400-e29b-41d4-a716-446655440000';
  let service: PublicServiceImpl;
  let prisma: any;

  const doctorFixture = {
    id: doctorId,
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
      verificationStatus: 'ACTIVE',
      bankName: 'SECRET-BANK',
      bankAccountNumber: 'SECRET-ACCOUNT',
      taxCode: 'SECRET-TAX',
      licenseNumber: 'SECRET-LICENSE',
    },
    user: { avatarUrl: '/images/doctor-1.jpg' },
    credentials: [
      {
        id: 'cred-1',
        credentialType: 'DEGREE',
        issuingAuthority: 'Đại học Paris Descartes',
        issueDate: new Date('2008-01-01T00:00:00Z'),
        platformApproved: true,
        certificateNumber: 'SECRET-CCHN',
      },
    ],
    treatedCases: [
      {
        id: 'case-1',
        summary: 'Quản lý tăng huyết áp kháng trị cho bệnh nhân 72 tuổi.',
      },
    ],
    _count: { encounters: 7, reviews: 384 },
  };

  const packageFixture = {
    id: 'pkg-1',
    packageCode: 'PKG-FAMILY-01',
    packageName: 'Gói Đồng Hành',
    durationMonths: 3,
    basePrice: 2850000,
    periodicVisitsQuota: 3,
    telehealthQuota: 4,
    includedMembers: 3,
    maxMembers: 6,
    additionalMemberMonthlyPrice: 75000,
    description: 'Phù hợp gia đình 3-6 người',
  };

  const careItemsFixture = [
    {
      id: 'care-2',
      category: 'SERVICE_MODE',
      title: 'Telehealth 24/7',
      description: 'Tư vấn video',
      icon: 'videocam',
      sortOrder: 2,
    },
    {
      id: 'care-1',
      category: 'SERVICE_MODE',
      title: 'Khám tận nhà',
      description: 'Khám tại nhà',
      icon: 'home',
      sortOrder: 1,
    },
    {
      id: 'care-3',
      category: 'COMMITMENT',
      title: 'Hồ sơ bệnh án điện tử',
      description: 'Lưu trữ trọn đời',
      icon: 'folder',
      sortOrder: 1,
    },
  ];

  const reviewFixtures = [
    {
      id: 'review-1',
      ratingStars: 5,
      reviewComment: 'Bác sĩ rất tận tâm.',
      createdAt: new Date('2026-11-01T10:00:00Z'),
      encounter: {
        contract: { servicePackage: { packageName: 'Gói Đồng Hành' } },
      },
      familyUnit: {
        homeAddress: '123 Nguyễn Thị Thập, Quận 7, TP.HCM',
        representativeUser: { fullName: 'Nguyễn Văn An' },
      },
    },
    {
      id: 'review-2',
      ratingStars: 4,
      reviewComment: '   ',
      createdAt: new Date('2026-10-20T10:00:00Z'),
      encounter: {
        contract: { servicePackage: { packageName: 'Gói An Tâm' } },
      },
      familyUnit: {
        homeAddress: '1 Lê Lợi, Quận 1, TP.HCM',
        representativeUser: { fullName: 'Trần Bình' },
      },
    },
  ];

  beforeEach(async () => {
    prisma = {
      doctor: { findUnique: jest.fn() },
      servicePackage: { findMany: jest.fn() },
      platformCareItem: { findMany: jest.fn() },
      doctorReview: { findMany: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PublicServiceImpl,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<PublicServiceImpl>(PublicServiceImpl);

    prisma.doctor.findUnique.mockResolvedValue(doctorFixture);
    prisma.servicePackage.findMany.mockResolvedValue([packageFixture]);
    prisma.platformCareItem.findMany.mockResolvedValue(careItemsFixture);
    prisma.doctorReview.findMany.mockResolvedValue(reviewFixtures);
  });

  it('returns the canonical profile without sensitive facility or credential data', async () => {
    const result: PublicDoctorDetailDto =
      await service.getPublicDoctorDetail(doctorId);

    expect(result).toMatchObject({
      id: doctorId,
      doctorName: 'Nguyễn Văn Hoài',
      academicTitle: 'PGS. TS. Bác sĩ',
      specialty: 'Bác sĩ Gia đình & Nội Tổng Quát',
      isVerified: true,
      isAvailable: true,
      panel: { activeCount: 18, maxCapacity: 30 },
      stats: {
        experienceYears: 24,
        ratingAvg: 4.96,
        totalReviews: 384,
        completedEncounters: 7,
      },
    });

    expect(result.facility).toEqual({
      id: 'fac-1',
      facilityName: 'Bệnh viện Đại học Y Dược TP.HCM',
      address: '215 Hồng Bàng, Phường 11, Quận 5',
      verificationStatus: 'ACTIVE',
    });

    expect(result.credentials).toEqual([
      {
        id: 'cred-1',
        type: 'DEGREE',
        typeLabel: 'Bằng cấp chuyên môn',
        issuingAuthority: 'Đại học Paris Descartes',
        issueYear: 2008,
        verified: true,
      },
    ]);

    expect(result.treatedCases).toEqual([
      {
        id: 'case-1',
        summary: 'Quản lý tăng huyết áp kháng trị cho bệnh nhân 72 tuổi.',
      },
    ]);

    expect(result.careModel.serviceModes.map((item) => item.id)).toEqual([
      'care-2',
      'care-1',
    ]);
    expect(result.careModel.commitments.map((item) => item.id)).toEqual([
      'care-3',
    ]);

    expect(result.carePackages[0]).toMatchObject({
      id: 'pkg-1',
      packageCode: 'PKG-FAMILY-01',
      packageName: 'Gói Đồng Hành',
      durationMonths: 3,
      basePrice: 2850000,
      includedMembers: 3,
      maxMembers: 6,
    });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('SECRET-BANK');
    expect(serialized).not.toContain('SECRET-ACCOUNT');
    expect(serialized).not.toContain('SECRET-TAX');
    expect(serialized).not.toContain('SECRET-LICENSE');
    expect(serialized).not.toContain('SECRET-CCHN');

    expect(result).not.toHaveProperty('services');
    expect(result).not.toHaveProperty('schedule');
    expect(result).not.toHaveProperty('hospital');
    expect(result).not.toHaveProperty('location');
    expect(result).not.toHaveProperty('fee');
  });

  it('queries only approved treated cases, approved credentials and active care content', async () => {
    await service.getPublicDoctorDetail(doctorId);

    expect(prisma.doctor.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: doctorId },
        select: expect.objectContaining({
          credentials: expect.objectContaining({
            where: { platformApproved: true },
          }),
          treatedCases: expect.objectContaining({
            where: { status: 'APPROVED' },
          }),
          _count: {
            select: {
              encounters: { where: { encounterStatus: 'COMPLETED' } },
              reviews: true,
            },
          },
        }),
      }),
    );

    expect(prisma.platformCareItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true } }),
    );
    expect(prisma.doctorReview.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 5 }),
    );
  });

  it('masks patient names, keeps only reviews with content and uses the encounter package', async () => {
    const result = await service.getPublicDoctorDetail(doctorId);

    expect(result.reviews.items).toHaveLength(1);
    expect(result.reviews.items[0]).toMatchObject({
      id: 'review-1',
      patientDisplayName: 'Nguyễn V. A.',
      ratingStars: 5,
      comment: 'Bác sĩ rất tận tâm.',
      packageName: 'Gói Đồng Hành',
      district: 'Quận 7',
    });
    expect(result.reviews.ratingAvg).toBe(4.96);
    expect(result.reviews.totalReviews).toBe(384);
  });

  it('masks single-token and empty names safely', () => {
    expect((service as any).maskPatientName('Lan')).toBe('L.');
    expect((service as any).maskPatientName('')).toBe('Hội viên gia đình');
    expect((service as any).maskPatientName(null)).toBe('Hội viên gia đình');
  });

  it('returns a null rating when the doctor has no reviews', async () => {
    prisma.doctor.findUnique.mockResolvedValue({
      ...doctorFixture,
      totalReviews: 0,
      ratingAvg: 5,
      _count: { encounters: 0, reviews: 0 },
    });
    prisma.doctorReview.findMany.mockResolvedValue([]);

    const result = await service.getPublicDoctorDetail(doctorId);

    expect(result.stats.ratingAvg).toBeNull();
    expect(result.reviews.ratingAvg).toBeNull();
    expect(result.reviews.items).toEqual([]);
  });

  it('throws NotFoundException when the doctor is missing or inactive', async () => {
    prisma.doctor.findUnique.mockResolvedValue(null);
    await expect(service.getPublicDoctorDetail(doctorId)).rejects.toThrow(
      NotFoundException,
    );

    prisma.doctor.findUnique.mockResolvedValue({
      ...doctorFixture,
      onboardingStatus: 'SUSPENDED',
    });
    await expect(service.getPublicDoctorDetail(doctorId)).rejects.toThrow(
      NotFoundException,
    );
  });

  describe('PublicController', () => {
    let controller: PublicController;
    let serviceMock: jest.Mocked<IPublicService>;

    beforeEach(async () => {
      serviceMock = {
        getPublicPortalOverview: jest.fn(),
        searchPublicPackages: jest.fn(),
        getPublicPackageDetail: jest.fn(),
        lookupHealthcareFacilities: jest.fn(),
        lookupDoctorDirectory: jest.fn(),
        submitConsultationRequest: jest.fn(),
        getPublicFacilityDetail: jest.fn(),
        getPublicDoctorDetail: jest.fn(),
        getDoctorReviews: jest.fn(),
        getPublicCareModel: jest.fn(),
      } as any;

      const module: TestingModule = await Test.createTestingModule({
        controllers: [PublicController],
        providers: [{ provide: PUBLIC_SERVICE_TOKEN, useValue: serviceMock }],
      }).compile();

      controller = module.get<PublicController>(PublicController);
    });

    it('delegates doctor detail requests to the service', async () => {
      const mockResult = { id: doctorId } as any;
      serviceMock.getPublicDoctorDetail.mockResolvedValue(mockResult);

      await expect(controller.getPublicDoctorDetail(doctorId)).resolves.toBe(
        mockResult,
      );
      expect(serviceMock.getPublicDoctorDetail).toHaveBeenCalledWith(doctorId);
    });

    it('delegates public care model requests to the service', async () => {
      const mockResult = { serviceModes: [], commitments: [] } as any;
      serviceMock.getPublicCareModel.mockResolvedValue(mockResult);

      await expect(controller.getPublicCareModel()).resolves.toBe(mockResult);
    });
  });
});
