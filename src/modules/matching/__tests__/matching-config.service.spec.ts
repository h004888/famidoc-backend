import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { DoctorClinicalTier } from '@prisma/client';
import type { AuthenticatedUser } from '../../../core/auth/authenticated-request';
import { DoctorMatchingService } from '../services/doctor-matching.service';
import { JevClientService } from '../services/jev-client.service';
import {
  assertSafeSystemOneUrl,
  MATCHING_CONFIG_KEYS,
  MatchingConfigService,
  maskApiKey,
} from '../services/matching-config.service';

describe('MatchingConfigService & System One Admin Test (Tasks 4.3 & 4.4)', () => {
  const adminUser: AuthenticatedUser = {
    id: 'admin-1',
    role: 'ADMIN',
    familyUnitId: null,
  };

  const familyUser: AuthenticatedUser = {
    id: 'fam-1',
    role: 'FAMILY_REP',
    familyUnitId: 'family-1',
  };

  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.TYPESAFE_API_URL;
    delete process.env.TYPESAFE_API_KEY;
    delete process.env.TYPESAFE_JEV_MODEL;
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  it('blocks SSRF metadata and non-http URLs while allowing local Ollama URLs', () => {
    expect(() =>
      assertSafeSystemOneUrl('http://localhost:11434/v1/systemone'),
    ).not.toThrow();
    expect(() =>
      assertSafeSystemOneUrl('http://host.docker.internal:11434/v1/systemone'),
    ).not.toThrow();
    expect(() =>
      assertSafeSystemOneUrl('http://169.254.169.254/latest/meta-data'),
    ).toThrow(BadRequestException);
    expect(() =>
      assertSafeSystemOneUrl('ftp://localhost:11434/v1/systemone'),
    ).toThrow(BadRequestException);
    expect(() =>
      assertSafeSystemOneUrl('http://user:secret@localhost:11434/v1/systemone'),
    ).toThrow(BadRequestException);
  });

  it('reads SystemConfiguration with DB priority over .env and masks API key on Admin GET', async () => {
    process.env.TYPESAFE_API_KEY = 'ts_env_secret_12345';
    process.env.TYPESAFE_API_URL = 'https://api.typesafe.ai/v1/systemone';

    const prismaMock: any = {
      systemConfiguration: {
        findMany: jest.fn().mockResolvedValue([
          {
            configKey: MATCHING_CONFIG_KEYS.URL,
            configValue: 'http://localhost:11434/v1/systemone',
            updatedAt: new Date('2026-11-18T03:00:00Z'),
          },
          {
            configKey: MATCHING_CONFIG_KEYS.MODEL,
            configValue: 'd3:4b',
            updatedAt: new Date('2026-11-18T03:05:00Z'),
          },
          {
            configKey: MATCHING_CONFIG_KEYS.API_KEY,
            configValue: '',
            updatedAt: new Date('2026-11-18T03:05:00Z'),
          },
        ]),
      },
    };

    const service = new MatchingConfigService(prismaMock);
    const view = await service.getAdminConfig(adminUser);

    expect(view.endpointUrl).toBe('http://localhost:11434/v1/systemone');
    expect(view.modelName).toBe('d3:4b');
    expect(view.isLocalEndpoint).toBe(true);
    expect(view.hasApiKey).toBe(false);
    expect(view.apiKeyMasked).toBeNull();
    expect(maskApiKey('ts_live_12345678')).toBe('ts_****5678');

    await expect(service.getAdminConfig(familyUser)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('upserts config into SystemConfiguration, validates weights sum = 1, and records AuditLog without plaintext key', async () => {
    const upsertMock = jest.fn().mockResolvedValue({});
    const auditMock = jest.fn().mockResolvedValue({});
    const findManyMock = jest.fn().mockResolvedValue([
      {
        configKey: MATCHING_CONFIG_KEYS.URL,
        configValue: 'http://localhost:11434/v1/systemone',
        updatedAt: new Date(),
      },
      {
        configKey: MATCHING_CONFIG_KEYS.MODEL,
        configValue: 'd3:4b',
        updatedAt: new Date(),
      },
      {
        configKey: MATCHING_CONFIG_KEYS.API_KEY,
        configValue: 'sk_secret_9999',
        updatedAt: new Date(),
      },
    ]);

    const prismaMock: any = {
      systemConfiguration: {
        findMany: findManyMock,
        upsert: upsertMock,
      },
      auditLog: {
        create: auditMock,
      },
      $transaction: jest.fn(async (cb: any) => cb(prismaMock)),
    };

    const service = new MatchingConfigService(prismaMock);

    await expect(
      service.updateAdminConfig(
        adminUser,
        { fitWeight: 0.8, vacancyWeight: 0.5 },
        '127.0.0.1',
      ),
    ).rejects.toThrow(BadRequestException);

    const updated = await service.updateAdminConfig(
      adminUser,
      {
        endpointUrl: 'http://localhost:11434/v1/systemone',
        modelName: 'd3:4b',
        questionType: 'score',
        apiKey: 'sk_secret_9999',
        timeoutMs: 25000,
        maxCandidates: 10,
        minFitThreshold: 0.6,
        fitWeight: 0.7,
        vacancyWeight: 0.3,
      },
      '127.0.0.1',
    );

    expect(upsertMock).toHaveBeenCalled();
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'ADMIN_UPDATE_MATCHING_CONFIG',
          resourceName: 'system_configurations',
          details: expect.objectContaining({
            apiKeyChanged: true,
            modelName: 'd3:4b',
          }),
        }),
      }),
    );
    const auditDetails = JSON.stringify(auditMock.mock.calls[0][0].data.details);
    expect(auditDetails).not.toContain('sk_secret_9999');
    expect(updated.apiKeyMasked).toBe('sk_****9999');
  });

  it('runs dry-run connection test against draft /v1/systemone endpoint and returns normalized scores + latency', async () => {
    const prismaMock: any = {
      systemConfiguration: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const configService = new MatchingConfigService(prismaMock);
    const jevClient = new JevClientService(configService);

    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        model: 'd3:4b',
        answers: {
          'doc-match': {
            type: 'score',
            score: 3.92,
            legend: { '0': '0', '1': '1', '2': '2', '3': '3', '4': '4' },
            confidence: 0.9,
          },
          'doc-mismatch': {
            type: 'score',
            score: 0.24,
            legend: { '0': '0', '1': '1', '2': '2', '3': '3', '4': '4' },
            confidence: 0.87,
          },
        },
      }),
    } as any);

    const probe = await jevClient.testSystemOneConnection(adminUser, {
      endpointUrl: 'http://localhost:11434/v1/systemone',
      modelName: 'd3:4b',
      questionType: 'score',
    });

    expect(probe.ok).toBe(true);
    expect(probe.httpStatus).toBe(200);
    expect(probe.resolvedModel).toBe('d3:4b');
    expect(probe.latencyMs).toBeGreaterThanOrEqual(0);
    expect(probe.sampleScores).toHaveLength(2);
    expect(probe.sampleScores[0].fitScore).toBeCloseTo(3.92 / 4, 4);
  });

  it('DoctorMatchingService applies runtime thresholds & weights from MatchingConfigService', async () => {
    const prismaMock: any = {
      systemConfiguration: {
        findMany: jest.fn().mockResolvedValue([
          {
            configKey: MATCHING_CONFIG_KEYS.MIN_FIT_THRESHOLD,
            configValue: '0.85',
            updatedAt: new Date(),
          },
          {
            configKey: MATCHING_CONFIG_KEYS.MAX_CANDIDATES,
            configValue: '5',
            updatedAt: new Date(),
          },
        ]),
      },
      servicePackage: {
        findUnique: jest.fn().mockResolvedValue({
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
        }),
      },
      doctor: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'doc-1',
            facilityId: 'fac-1',
            doctorName: 'BS. 1',
            specialty: 'Tim mạch',
            academicTitle: 'ThS.BS',
            experienceYears: 8,
            clinicalTier: DoctorClinicalTier.STANDARD,
            bio: 'Tim mạch',
            ratingAvg: 4.9,
            totalReviews: 10,
            activePanelCount: 2,
            maxPanelCapacity: 30,
            onboardingStatus: 'ACTIVE',
            user: { avatarUrl: null },
            facility: {
              id: 'fac-1',
              facilityName: 'PK 1',
              address: 'Quận 1',
              hotline: '1900',
              verificationStatus: 'ACTIVE',
            },
            treatedCases: [],
          },
        ]),
      },
      medicalContract: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      matchingSession: {
        create: jest.fn().mockImplementation(({ data }: any) => ({
          id: 'match-sess-rt-1',
          ...data,
        })),
      },
      matchingQueueRequest: {
        create: jest.fn().mockImplementation(({ data }: any) => ({
          id: 'queue-rt-1',
          ...data,
        })),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      notification: {
        create: jest.fn(),
        createMany: jest.fn(),
      },
      $transaction: jest.fn(async (cb: any) => cb(prismaMock)),
    };

    const configService = new MatchingConfigService(prismaMock);
    const jevMock: any = {
      scoreCandidates: jest.fn().mockResolvedValue({
        ok: true,
        modelVersion: 'd3:4b',
        scores: [{ doctorId: 'doc-1', fitScore: 0.75 }],
      }),
    };
    const matchingService = new DoctorMatchingService(
      prismaMock,
      jevMock,
      undefined,
      configService,
    );

    const res = await matchingService.matchDoctors(familyUser, {
      packageId: 'pkg-1',
      memberCount: 3,
      careCategories: ['Tim mạch'],
    });

    // Vì ngưỡng runtime đặt 0.85 nên điểm 0.75 bị chuyển sang QUEUED
    expect(res.outcome).toBe('QUEUED');
    if (res.outcome === 'QUEUED') {
      expect(res.fallbackReason).toBe('BELOW_FIT_THRESHOLD');
    }
  });
});
