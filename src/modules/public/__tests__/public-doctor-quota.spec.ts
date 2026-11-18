import { DoctorClinicalTier } from '@prisma/client';
import { PublicServiceImpl } from '../services/impl/public.service.impl';

describe('PublicServiceImpl - Doctor Quota, ClinicalTier & Junior Alternatives (Task 3.1)', () => {
  const baseDoctor = {
    id: 'doc-senior-1',
    doctorName: 'PGS.TS Nguyễn Văn Hoài',
    academicTitle: 'PGS.TS',
    specialty: 'Y học gia đình',
    experienceYears: 20,
    clinicalTier: DoctorClinicalTier.SENIOR,
    bio: 'Bác sĩ giàu kinh nghiệm',
    ratingAvg: 4.9,
    totalReviews: 100,
    activePanelCount: 25,
    maxPanelCapacity: 30,
    onboardingStatus: 'ACTIVE',
    user: { avatarUrl: null },
    facility: {
      id: 'fac-1',
      facilityName: 'Phòng khám FamiDoc',
      address: 'Quận 1, TP.HCM',
      hotline: '1900 1234',
      verificationStatus: 'ACTIVE',
    },
    credentials: [{ id: 'c1', credentialType: 'DEGREE', issuingAuthority: 'ĐH Y', issueDate: new Date('2005-01-01'), platformApproved: true }],
    treatedCases: [],
    _count: { encounters: 10, reviews: 100 },
  };

  const juniorDoctor = {
    id: 'doc-junior-1',
    doctorName: 'BS. Trần Minh Trẻ',
    academicTitle: 'BS',
    specialty: 'Y học gia đình',
    experienceYears: 3,
    clinicalTier: DoctorClinicalTier.JUNIOR,
    bio: 'Bác sĩ trẻ tận tâm',
    ratingAvg: 4.8,
    totalReviews: 12,
    activePanelCount: 5,
    maxPanelCapacity: 30,
    onboardingStatus: 'ACTIVE',
    user: { avatarUrl: null },
    facility: {
      id: 'fac-1',
      facilityName: 'Phòng khám FamiDoc',
      address: 'Quận 1, TP.HCM',
      hotline: '1900 1234',
    },
  };

  const packages = [
    {
      id: 'pkg-low',
      packageCode: 'TRAI_NGHIEM',
      packageName: 'Gói Trải Nghiệm',
      durationMonths: 1,
      basePrice: 1000000,
      periodicVisitsQuota: 1,
      telehealthQuota: 2,
      includedMembers: 2,
      maxMembers: 6,
      additionalMemberMonthlyPrice: 75000,
      description: 'Gói phí thấp',
    },
    {
      id: 'pkg-mid',
      packageCode: 'DONG_HANH',
      packageName: 'Gói Đồng Hành',
      durationMonths: 3,
      basePrice: 2850000,
      periodicVisitsQuota: 3,
      telehealthQuota: 10,
      includedMembers: 4,
      maxMembers: 6,
      additionalMemberMonthlyPrice: 75000,
      description: 'Gói phổ biến',
    },
  ];

  it('returns remainingSlots and isQuotaFull=false when doctor still has open slots', async () => {
    const prismaMock: any = {
      doctor: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([baseDoctor]),
        findUnique: jest.fn().mockResolvedValue(baseDoctor),
      },
      medicalContract: {
        // 25 active/held contracts out of 30 capacity => 5 slots remaining
        findMany: jest.fn().mockResolvedValue(
          Array.from({ length: 27 }, () => ({ doctorId: baseDoctor.id })),
        ),
      },
      servicePackage: { findMany: jest.fn().mockResolvedValue(packages) },
      platformCareItem: { findMany: jest.fn().mockResolvedValue([]) },
      doctorReview: { findMany: jest.fn().mockResolvedValue([]) },
    };

    const service = new PublicServiceImpl(prismaMock);

    const list = await service.lookupDoctorDirectory({ page: 1, limit: 10 });
    expect(list.items[0]).toMatchObject({
      id: 'doc-senior-1',
      clinicalTier: 'SENIOR',
      remainingSlots: 3,
      isQuotaFull: false,
      isAvailable: true,
    });

    const detail = await service.getPublicDoctorDetail('doc-senior-1');
    expect(detail.clinicalTier).toBe('SENIOR');
    expect(detail.remainingSlots).toBe(3);
    expect(detail.isQuotaFull).toBe(false);
    expect(detail.juniorAlternatives).toBeUndefined();
    expect(detail.lowerPricePackages).toBeUndefined();
  });

  it('locks direct registration and returns juniorAlternatives + lowerPricePackages when quota is full', async () => {
    const prismaMock: any = {
      doctor: {
        findUnique: jest.fn().mockResolvedValue(baseDoctor),
        findMany: jest.fn().mockResolvedValue([juniorDoctor]),
      },
      medicalContract: {
        findMany: jest.fn().mockImplementation(({ where }) => {
          const ids: string[] = where?.doctorId?.in ?? [];
          if (ids.includes('doc-senior-1')) {
            return Promise.resolve(
              Array.from({ length: 30 }, () => ({ doctorId: 'doc-senior-1' })),
            );
          }
          return Promise.resolve(
            Array.from({ length: 5 }, () => ({ doctorId: 'doc-junior-1' })),
          );
        }),
      },
      servicePackage: { findMany: jest.fn().mockResolvedValue(packages) },
      platformCareItem: { findMany: jest.fn().mockResolvedValue([]) },
      doctorReview: { findMany: jest.fn().mockResolvedValue([]) },
    };

    const service = new PublicServiceImpl(prismaMock);
    const detail = await service.getPublicDoctorDetail('doc-senior-1');

    expect(detail.isQuotaFull).toBe(true);
    expect(detail.isAvailable).toBe(false);
    expect(detail.remainingSlots).toBe(0);
    expect(detail.juniorAlternatives).toHaveLength(1);
    expect(detail.juniorAlternatives?.[0]).toMatchObject({
      id: 'doc-junior-1',
      clinicalTier: 'JUNIOR',
      remainingSlots: 25,
      isQuotaFull: false,
    });
    expect(detail.lowerPricePackages).toHaveLength(2);
    expect(detail.lowerPricePackages?.[0].packageCode).toBe('TRAI_NGHIEM');
  });
});
