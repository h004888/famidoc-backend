import { BadRequestException, ConflictException } from '@nestjs/common';
import { DoctorClinicalTier, MatchingQueueStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../../../core/auth/authenticated-request';
import { DoctorMatchingService } from '../services/doctor-matching.service';

describe('DoctorMatchingService & Admin Queue (Tasks 4.1 & 4.2)', () => {
  const familyUser: AuthenticatedUser = {
    id: 'user-fam-1',
    role: 'FAMILY_REP',
    familyUnitId: 'fam-1',
  };

  const adminUser: AuthenticatedUser = {
    id: 'user-admin-1',
    role: 'ADMIN',
    familyUnitId: null,
  };

  const mockPackage = {
    id: 'pkg-1',
    packageCode: 'DONG_HANH',
    packageName: 'Gói Đồng Hành',
    durationMonths: 3,
    basePrice: 2850000,
    includedMembers: 3,
    maxMembers: 6,
    additionalMemberMonthlyPrice: 75000,
    periodicVisitsQuota: 3,
    telehealthQuota: 20,
    status: 'ACTIVE',
    deletedAt: null,
  };

  const candidateA = {
    id: 'doc-a',
    facilityId: 'fac-a',
    doctorName: 'BS. A (Gần đầy)',
    specialty: 'Y học gia đình',
    academicTitle: 'ThS.BS',
    experienceYears: 8,
    clinicalTier: DoctorClinicalTier.STANDARD,
    bio: 'Kinh nghiệm ngoại trú',
    ratingAvg: 4.9,
    totalReviews: 50,
    activePanelCount: 27,
    maxPanelCapacity: 30,
    onboardingStatus: 'ACTIVE',
    user: { avatarUrl: null },
    facility: {
      id: 'fac-a',
      facilityName: 'Phòng khám A',
      address: 'Quận 1, TP.HCM',
      hotline: '1900 1001',
      verificationStatus: 'ACTIVE',
    },
    treatedCases: [{ summary: 'Theo dõi tăng huyết áp' }],
  };

  const candidateB = {
    id: 'doc-b',
    facilityId: 'fac-b',
    doctorName: 'BS. B (Nhiều slot trống)',
    specialty: 'Y học gia đình',
    academicTitle: 'ThS.BS',
    experienceYears: 6,
    clinicalTier: DoctorClinicalTier.STANDARD,
    bio: 'Tận tâm chăm sóc gia đình',
    ratingAvg: 4.8,
    totalReviews: 20,
    activePanelCount: 3,
    maxPanelCapacity: 30,
    onboardingStatus: 'ACTIVE',
    user: { avatarUrl: null },
    facility: {
      id: 'fac-b',
      facilityName: 'Phòng khám B',
      address: 'Quận 1, TP.HCM',
      hotline: '1900 1002',
      verificationStatus: 'ACTIVE',
    },
    treatedCases: [{ summary: 'Chăm sóc người cao tuổi' }],
  };

  function createHarness() {
    const prismaMock: any = {
      servicePackage: { findUnique: jest.fn().mockResolvedValue(mockPackage) },
      doctor: {
        findMany: jest.fn().mockResolvedValue([candidateA, candidateB]),
        findUnique: jest.fn().mockResolvedValue(candidateB),
      },
      medicalContract: {
        findMany: jest.fn().mockResolvedValue([
          ...Array.from({ length: 27 }, () => ({ doctorId: 'doc-a' })),
          ...Array.from({ length: 3 }, () => ({ doctorId: 'doc-b' })),
        ]),
        count: jest.fn().mockResolvedValue(3),
      },
      matchingSession: {
        create: jest.fn().mockImplementation(({ data }) => ({
          id: 'match-sess-1',
          ...data,
        })),
      },
      matchingQueueRequest: {
        create: jest.fn().mockImplementation(({ data }) => ({
          id: 'queue-1',
          ...data,
        })),
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockImplementation(({ data }) => ({
          id: 'queue-1',
          ...data,
        })),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user-fam-1',
          email: 'family@famidoc.vn',
          fullName: 'Nguyễn Văn Gia Đình',
        }),
        findMany: jest.fn().mockResolvedValue([{ id: 'user-admin-1' }]),
      },
      notification: {
        create: jest.fn().mockResolvedValue({ id: 'notif-1' }),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({ id: 1n }),
      },
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'doc-b' }]),
      $transaction: jest.fn().mockImplementation(async (cb) => cb(prismaMock)),
    };

    const jevClientMock: any = {
      scoreCandidates: jest.fn(),
    };

    const mailerMock: any = {
      sendMail: jest.fn().mockResolvedValue({ messageId: 'mail-1' }),
    };

    const service = new DoctorMatchingService(
      prismaMock,
      jevClientMock,
      mailerMock,
    );

    return { service, prismaMock, jevClientMock, mailerMock };
  }

  it('rejects Track B intake when memberCount violates package bounds', async () => {
    const { service } = createHarness();
    await expect(
      service.matchDoctors(familyUser, {
        packageId: 'pkg-1',
        memberCount: 2, // < includedMembers (3)
        careCategories: ['Tim mạch'],
      }),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.matchDoctors(familyUser, {
        packageId: 'pkg-1',
        memberCount: 7, // > maxMembers (6)
        careCategories: ['Tim mạch'],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('balances 70% Jev fit and 30% partner vacancy to pick best composite doctor and infer facility', async () => {
    const { service, jevClientMock } = createHarness();
    jevClientMock.scoreCandidates.mockResolvedValue({
      ok: true,
      modelVersion: 'jev-1.14.0',
      scores: [
        // doc-a: 0.70*0.82 + 0.30*(3/30) = 0.574 + 0.03 = 0.604
        { doctorId: 'doc-a', fitScore: 0.82 },
        // doc-b: 0.70*0.80 + 0.30*(27/30) = 0.560 + 0.27 = 0.830
        { doctorId: 'doc-b', fitScore: 0.8, rationale: 'Phù hợp và còn nhiều slot' },
      ],
    });

    const result = await service.matchDoctors(familyUser, {
      packageId: 'pkg-1',
      memberCount: 4,
      requestedTier: DoctorClinicalTier.STANDARD,
      ageGroups: ['Người cao tuổi'],
      careCategories: ['Tăng huyết áp'],
      districtArea: 'Quận 1',
      careDescription: 'Cần theo dõi huyết áp tại nhà cho ông bà, SĐT 0901234567',
    });

    expect(result.outcome).toBe('MATCHED');
    if (result.outcome === 'MATCHED') {
      expect(result.doctor.id).toBe('doc-b');
      expect(result.facility.id).toBe('fac-b');
      expect(result.rankingSource).toBe('AI');
      expect(result.relaxedAcademicTitle).toBe(false);
      expect(result.scores.compositeScore).toBeCloseTo(0.83, 3);
      expect(result.matchingSessionId).toBe('match-sess-1');
      expect(result.alternatives).toHaveLength(1);
      expect(result.alternatives[0]?.doctor.id).toBe('doc-a');
      expect(result.alternatives[0]?.rank).toBe(2);
    }

    // Đảm bảo đã khử PII trước khi gọi TypeSafe Jev
    const sentInput = jevClientMock.scoreCandidates.mock.calls[0][0];
    expect(sentInput.sanitizedDescription).not.toContain('0901234567');
  });

  it('keeps Top 1 + alternatives without routing to Admin Queue even when Jev scores are below 0.60', async () => {
    const { service, jevClientMock, prismaMock, mailerMock } = createHarness();
    jevClientMock.scoreCandidates.mockResolvedValue({
      ok: true,
      modelVersion: 'jev-1.14.0',
      scores: [
        { doctorId: 'doc-a', fitScore: 0.55 },
        { doctorId: 'doc-b', fitScore: 0.48 },
      ],
    });

    const result = await service.matchDoctors(familyUser, {
      packageId: 'pkg-1',
      memberCount: 4,
      careCategories: ['Chăm sóc giảm nhẹ'],
    });

    expect(result.outcome).toBe('MATCHED');
    if (result.outcome === 'MATCHED') {
      expect(result.rankingSource).toBe('AI');
      expect(result.doctor.id).toBe('doc-b');
      expect(result.alternatives).toHaveLength(1);
    }
    expect(prismaMock.matchingQueueRequest.create).not.toHaveBeenCalled();
    expect(mailerMock.sendMail).not.toHaveBeenCalled();
  });

  it('falls back to deterministic ranking when Jev AI fails or times out', async () => {
    const { service, jevClientMock, prismaMock } = createHarness();
    jevClientMock.scoreCandidates.mockResolvedValue({
      ok: false,
      modelVersion: 'jev-1.14.0',
      scores: [],
      errorReason: 'TIMEOUT',
    });

    const result = await service.matchDoctors(familyUser, {
      packageId: 'pkg-1',
      memberCount: 4,
      careCategories: ['Tim mạch · Huyết áp'],
      districtArea: 'Quận 1, TP. Hồ Chí Minh',
    });

    expect(result.outcome).toBe('MATCHED');
    if (result.outcome === 'MATCHED') {
      expect(result.rankingSource).toBe('FALLBACK');
      expect(result.doctor.id).toBe('doc-a');
      expect(result.alternatives).toHaveLength(1);
    }
    expect(prismaMock.matchingQueueRequest.create).not.toHaveBeenCalled();
  });

  it('uses progressive 2-tier query when requestedAcademicTitle has fewer than 4 candidates and returns PLATFORM_FULL when 0 open doctors exist', async () => {
    const { service, jevClientMock, prismaMock } = createHarness();
    prismaMock.doctor.findMany
      .mockResolvedValueOnce([]) // Tier 1 (GS.TS.BS) = 0
      .mockResolvedValueOnce([candidateA, candidateB]); // Tier 2 fallback
    jevClientMock.scoreCandidates.mockResolvedValue({
      ok: true,
      modelVersion: 'jev-1.14.0',
      scores: [
        { doctorId: 'doc-a', fitScore: 0.8 },
        { doctorId: 'doc-b', fitScore: 0.85 },
      ],
    });

    const relaxedResult = await service.matchDoctors(familyUser, {
      packageId: 'pkg-1',
      memberCount: 4,
      requestedAcademicTitle: 'GS.TS.BS',
      careCategories: ['Tim mạch · Huyết áp'],
    });

    expect(relaxedResult.outcome).toBe('MATCHED');
    if (relaxedResult.outcome === 'MATCHED') {
      expect(relaxedResult.relaxedAcademicTitle).toBe(true);
      expect(relaxedResult.requestedAcademicTitle).toBe('GS.TS.BS');
      expect(relaxedResult.doctor.id).toBe('doc-b');
    }

    // Toàn sàn hết slot -> PLATFORM_FULL
    prismaMock.doctor.findMany.mockResolvedValue([]);
    const fullResult = await service.matchDoctors(familyUser, {
      packageId: 'pkg-1',
      memberCount: 4,
      careCategories: ['Tim mạch'],
    });

    expect(fullResult.outcome).toBe('PLATFORM_FULL');
    if (fullResult.outcome === 'PLATFORM_FULL') {
      expect(fullResult.hotline).toBe('1900 8821');
    }
  });

  it('allows family to cancel QUEUED request and expires overdue requests via SLA', async () => {
    const { service, prismaMock } = createHarness();
    prismaMock.matchingQueueRequest.findUnique.mockResolvedValue({
      id: 'queue-1',
      userId: 'user-fam-1',
      familyId: 'fam-1',
      status: MatchingQueueStatus.QUEUED,
    });

    const cancelled = await service.cancelQueueRequest(
      familyUser,
      'queue-1',
      { reason: 'Đã chọn bác sĩ khác' },
    );
    expect(cancelled.status).toBe(MatchingQueueStatus.CANCELLED);

    prismaMock.matchingQueueRequest.findMany.mockResolvedValueOnce([
      { id: 'queue-overdue', userId: 'user-fam-1' },
    ]);
    const expired = await service.expireSlaQueueRequests(new Date());
    expect(expired.expired).toBe(1);
    expect(prismaMock.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'MATCHING_QUEUE_EXPIRED',
          referenceId: 'queue-overdue',
        }),
      }),
    );
  });

  it('allows Admin to assign an open-slot doctor, infers facilityId, and sends Notification + Email; blocks full doctor with 409', async () => {
    const { service, prismaMock, mailerMock } = createHarness();
    prismaMock.matchingQueueRequest.findUnique.mockResolvedValue({
      id: 'queue-1',
      userId: 'user-fam-1',
      familyId: 'fam-1',
      status: MatchingQueueStatus.QUEUED,
      slaExpiresAt: new Date(Date.now() + 3600_000),
      servicePackage: { id: 'pkg-1', packageName: 'Gói Đồng Hành' },
      user: {
        id: 'user-fam-1',
        email: 'family@famidoc.vn',
        fullName: 'Gia đình A',
      },
      familyUnit: null,
    });

    // Nhánh bác sĩ kín slot -> 409 Conflict
    prismaMock.medicalContract.count.mockResolvedValueOnce(30);
    await expect(
      service.assignQueueDoctor(
        adminUser,
        'queue-1',
        { doctorId: 'doc-b' },
        '127.0.0.1',
      ),
    ).rejects.toThrow(ConflictException);

    // Nhánh bác sĩ còn slot -> ASSIGNED + suy ra facilityId + gửi thông báo & email
    prismaMock.medicalContract.count.mockResolvedValueOnce(3);
    const assigned = await service.assignQueueDoctor(
      adminUser,
      'queue-1',
      { doctorId: 'doc-b', adminNote: 'Phân công bác sĩ phù hợp' },
      '127.0.0.1',
    );
    expect(assigned.status).toBe(MatchingQueueStatus.ASSIGNED);
    expect(assigned.assignedFacilityId).toBe('fac-b');
    expect(prismaMock.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user-fam-1',
          type: 'MATCHING_QUEUE_ASSIGNED',
        }),
      }),
    );
    expect(mailerMock.sendMail).toHaveBeenCalledTimes(1);
    expect(mailerMock.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'family@famidoc.vn',
        subject:
          'FamiDoc - Đã phân công bác sĩ gia đình, mời xác nhận hợp đồng',
        text: expect.stringContaining('BS. B (Nhiều slot trống)'),
        html: expect.stringContaining('BS. B (Nhiều slot trống)'),
      }),
    );
  });
});
