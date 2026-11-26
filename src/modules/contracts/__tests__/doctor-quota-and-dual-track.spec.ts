import {
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { AuthenticatedUser } from '../../../core/auth/authenticated-request';
import { ContractsServiceImpl } from '../services/impl/contracts.service.impl';
import { SlotLedgerService } from '../../scheduling/slot-ledger.service';
import {
  CONTRACTS_REPOSITORY_TOKEN,
  type IContractsRepository,
} from '../repositories/interfaces/contracts.repository.interface';
import { PrismaContractsSession } from '../repositories/impl/contracts.repository.impl';
import { DocumensoClientService } from '../services/documenso-client.service';
import { ContractHoldCleanupService } from '../services/contract-hold-cleanup.service';

describe('Doctor Quota Holds, TTL Cleanup, Facility Inference & Dual-Track Linking (Tasks 2.1 & 3.2)', () => {
  const familyRepUser: AuthenticatedUser = {
    id: 'user-rep-1',
    role: 'FAMILY_REP',
    familyUnitId: 'fam-uuid-1',
  };

  const mockPackage = {
    id: 'pkg-1',
    lineageCode: 'PKG-STANDARD',
    version: 1,
    packageName: 'Gói Đồng Hành',
    description: 'Chăm sóc gia đình',
    durationMonths: 3,
    basePrice: '2850000',
    includedMembers: 4,
    maxMembers: 6,
    additionalMemberMonthlyPrice: '75000',
    quotaPeriod: 'PER_TERM',
    periodicVisitsQuota: 3,
    telehealthQuota: 20,
    status: 'ACTIVE',
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    publishedAt: new Date(),
  };

  const mockFacility = {
    id: 'fac-inferred-1',
    userId: 'facility-user-1',
    facilityName: 'Phòng khám Đa khoa FamiDoc',
    verificationStatus: 'ACTIVE',
  };

  const mockDoctor = {
    id: 'doc-1',
    userId: 'doctor-user-1',
    facilityId: 'fac-inferred-1',
    doctorName: 'BS. Nguyễn Văn An',
    onboardingStatus: 'ACTIVE',
    activePanelCount: 10,
    maxPanelCapacity: 30,
    user: { id: 'doctor-user-1', email: 'doc@famidoc.vn', fullName: 'BS. An' },
    credentials: [],
  };

  const mockFamily = {
    id: 'fam-uuid-1',
    representativeUserId: 'user-rep-1',
    homeAddress: '12 Nguyễn Huệ, Quận 1, TP.HCM',
    emergencyPhone: '0901234567',
    status: 'ACTIVE',
    representativeUser: {
      id: 'user-rep-1',
      email: 'family@famidoc.vn',
      fullName: 'Nguyễn Văn A',
    },
  };

  it('infers facilityId from doctor.facilityId when client omits facilityId', async () => {
    const createMedicalContract = jest.fn().mockImplementation((data) => ({
      id: 'contract-new-1',
      ...data,
      familyUnit: mockFamily,
      facility: mockFacility,
      doctor: mockDoctor,
      servicePackage: mockPackage,
    }));

    const sessionMock = {
      findPackage: jest.fn().mockResolvedValue(mockPackage),
      lockDoctorAndCountActiveAndHeld: jest.fn().mockResolvedValue({
        doctor: mockDoctor,
        activeAndHeldCount: 15,
      }),
      findFacilityById: jest.fn().mockResolvedValue(mockFacility),
      findActiveStaffingContract: jest.fn().mockResolvedValue({
        id: 'staff-1',
        status: 'ACTIVE',
      }),
      findFamilyById: jest.fn().mockResolvedValue(mockFamily),
      createMedicalContract,
      recordChange: jest.fn().mockResolvedValue(undefined),
    };

    const repositoryMock: Partial<IContractsRepository> = {
      transaction: jest.fn().mockImplementation(async (cb) => cb(sessionMock as any)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: SlotLedgerService, useValue: undefined },
        ContractsServiceImpl,
        { provide: CONTRACTS_REPOSITORY_TOKEN, useValue: repositoryMock },
      ],
    }).compile();

    const service = module.get(ContractsServiceImpl);
    const result = await service.createInitialMedicalContract(familyRepUser, {
      packageId: 'pkg-1',
      doctorId: 'doc-1',
      memberCount: 4,
    });

    expect(result.facilityId).toBe('fac-inferred-1');
    const [draft] = createMedicalContract.mock.calls[0];
    expect(draft.signingDeadlineAt.getTime() - draft.createdAt.getTime()).toBe(86_400_000);
    expect(draft.holdExpiresAt).toEqual(draft.signingDeadlineAt);
    expect(sessionMock.findFacilityById).toHaveBeenCalledWith('fac-inferred-1');
    expect(createMedicalContract).toHaveBeenCalledWith(
      expect.objectContaining({
        facilityId: 'fac-inferred-1',
        doctorId: 'doc-1',
        holdExpiresAt: expect.any(Date),
      }),
    );
  });

  it('throws 400 BadRequest when client sends mismatched facilityId for chosen doctor', async () => {
    const sessionMock = {
      findPackage: jest.fn().mockResolvedValue(mockPackage),
      lockDoctorAndCountActiveAndHeld: jest.fn().mockResolvedValue({
        doctor: mockDoctor,
        activeAndHeldCount: 10,
      }),
      findFacilityById: jest.fn(),
    };

    const service = new ContractsServiceImpl({
      transaction: jest.fn().mockImplementation(async (cb) => cb(sessionMock as any)),
    });

    await expect(
      service.createInitialMedicalContract(familyRepUser, {
        packageId: 'pkg-1',
        doctorId: 'doc-1',
        facilityId: 'fac-wrong-999',
        memberCount: 4,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects with 409 Conflict when active + held contracts reach maxPanelCapacity', async () => {
    const sessionMock = {
      findPackage: jest.fn().mockResolvedValue(mockPackage),
      lockDoctorAndCountActiveAndHeld: jest.fn().mockResolvedValue({
        doctor: { ...mockDoctor, activePanelCount: 25, maxPanelCapacity: 30 },
        activeAndHeldCount: 30,
      }),
    };

    const service = new ContractsServiceImpl({
      transaction: jest.fn().mockImplementation(async (cb) => cb(sessionMock as any)),
    });

    await expect(
      service.createInitialMedicalContract(familyRepUser, {
        packageId: 'pkg-1',
        doctorId: 'doc-1',
        memberCount: 4,
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('handles race condition for final slot across two concurrent requests and rolls back Documenso envelope', async () => {
    let currentActiveAndHeld = 29;
    const deleteEnvelope = jest.fn().mockResolvedValue(undefined);
    const createFourPartyEnvelope = jest
      .fn()
      .mockImplementationOnce(async () => {
        await new Promise((r) => setTimeout(r, 15));
        return { envelopeId: 'env-1', envelopeItemId: 'item-1', signers: [] };
      })
      .mockImplementationOnce(async () => {
        await new Promise((r) => setTimeout(r, 15));
        return { envelopeId: 'env-2', envelopeItemId: 'item-2', signers: [] };
      });

    const documensoMock = {
      isConfigured: () => true,
      createFourPartyEnvelope,
      deleteEnvelope,
    } as unknown as DocumensoClientService;

    let txChain: Promise<unknown> = Promise.resolve();
    const repoMock: IContractsRepository = {
      transaction: <T>(work: (session: any) => Promise<T>): Promise<T> => {
        const next = txChain.then(async () => {
          const session = {
            findPackage: jest.fn().mockResolvedValue(mockPackage),
            lockDoctorAndCountActiveAndHeld: jest.fn().mockImplementation(async () => ({
              doctor: { ...mockDoctor, maxPanelCapacity: 30 },
              activeAndHeldCount: currentActiveAndHeld,
            })),
            findFacilityById: jest.fn().mockResolvedValue(mockFacility),
            findActiveStaffingContract: jest
              .fn()
              .mockResolvedValue({ id: 'staff-1', status: 'ACTIVE' }),
            findFamilyById: jest.fn().mockResolvedValue(mockFamily),
            findFirstActiveAdminUser: jest
              .fn()
              .mockResolvedValue({ id: 'admin-1', email: 'admin@famidoc.vn', fullName: 'Admin' }),
            createMedicalContract: jest.fn().mockImplementation(async (data) => {
              currentActiveAndHeld += 1;
              return {
                id: `contract-${currentActiveAndHeld}`,
                ...data,
                familyUnit: mockFamily,
                facility: mockFacility,
                doctor: mockDoctor,
                servicePackage: mockPackage,
              };
            }),
            saveDocumensoSigners: jest.fn().mockResolvedValue(undefined),
            recordChange: jest.fn().mockResolvedValue(undefined),
          } as any;
          return work(session);
        });
        txChain = next.catch(() => undefined);
        return next;
      },
    };

    const pdfRendererMock = {
      renderPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 mock')),
    } as any;

    const service = new ContractsServiceImpl(
      repoMock,
      undefined,
      undefined,
      documensoMock,
      undefined,
      pdfRendererMock,
    );

    const [res1, res2] = await Promise.allSettled([
      service.createInitialMedicalContract(familyRepUser, {
        packageId: 'pkg-1',
        doctorId: 'doc-1',
        memberCount: 4,
      }),
      service.createInitialMedicalContract(familyRepUser, {
        packageId: 'pkg-1',
        doctorId: 'doc-1',
        memberCount: 4,
      }),
    ]);

    const fulfilled = [res1, res2].filter((r) => r.status === 'fulfilled');
    const rejected = [res1, res2].filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      ConflictException,
    );
    expect(deleteEnvelope).toHaveBeenCalledTimes(1);
  });

  it('releases slot when draft contract is cancelled and when hold TTL expires', async () => {
    const now = new Date();
    const contracts = [
      {
        id: 'draft-1',
        doctorId: 'doc-1',
        familyId: 'fam-uuid-1',
        contractStatus: 'PENDING_APPROVAL',
        holdExpiresAt: new Date(now.getTime() + 3600_000),
        documensoEnvelopeId: 'env-draft-1',
        familyUnit: mockFamily,
        facility: mockFacility,
        doctor: mockDoctor,
        servicePackage: mockPackage,
      },
    ];

    const txMock = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'doc-1' }]),
      doctor: {
        findUnique: jest.fn().mockResolvedValue(mockDoctor),
      },
      medicalContract: {
        count: jest.fn().mockImplementation(async ({ where }) => {
          return contracts.filter(
            (c) =>
              c.doctorId === where.doctorId &&
              ['ACTIVE', 'PENDING_APPROVAL', 'PENDING_PAYMENT'].includes(
                c.contractStatus,
              ),
          ).length;
        }),
      },
    } as any;

    const session = new PrismaContractsSession(txMock);
    const beforeCancel = await session.lockDoctorAndCountActiveAndHeld('doc-1');
    expect(beforeCancel?.activeAndHeldCount).toBe(1);

    contracts[0].contractStatus = 'TERMINATED';
    const afterCancel = await session.lockDoctorAndCountActiveAndHeld('doc-1');
    expect(afterCancel?.activeAndHeldCount).toBe(0);

    // Cleanup service test for TTL expiry
    const deleteEnvelope = jest.fn().mockResolvedValue(undefined);
    const prismaCleanupMock = {
      medicalContract: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'expired-1', documensoEnvelopeId: 'env-exp-1' },
        ]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      invoice: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn().mockImplementation(async (cb) => cb(prismaCleanupMock)),
    } as any;

    const cleanup = new ContractHoldCleanupService(prismaCleanupMock, {
      deleteEnvelope,
    } as any);
    const cleanupRes = await cleanup.releaseExpiredHolds(now);
    expect(cleanupRes.released).toBe(1);
    expect(deleteEnvelope).toHaveBeenCalledWith('env-exp-1');
  });

  it('links and confirms matchingSessionId or queueRequestId on contract creation', async () => {
    const markMatchingSessionConfirmed = jest.fn().mockResolvedValue(undefined);
    const markMatchingQueueConfirmed = jest.fn().mockResolvedValue(undefined);

    const sessionMock = {
      findPackage: jest.fn().mockResolvedValue(mockPackage),
      lockDoctorAndCountActiveAndHeld: jest.fn().mockResolvedValue({
        doctor: mockDoctor,
        activeAndHeldCount: 2,
      }),
      findFacilityById: jest.fn().mockResolvedValue(mockFacility),
      findActiveStaffingContract: jest
        .fn()
        .mockResolvedValue({ id: 'staff-1', status: 'ACTIVE' }),
      findFamilyById: jest.fn().mockResolvedValue(mockFamily),
      findMatchingSessionById: jest.fn().mockResolvedValue({
        id: 'match-sess-1',
        userId: 'user-rep-1',
        packageId: 'pkg-1',
        matchedDoctorId: 'doc-1',
        status: 'MATCHED',
        expiresAt: new Date(Date.now() + 3600_000),
      }),
      findMatchingQueueRequestById: jest.fn().mockResolvedValue({
        id: 'queue-req-1',
        userId: 'user-rep-1',
        familyId: 'fam-uuid-1',
        packageId: 'pkg-1',
        assignedDoctorId: 'doc-1',
        status: 'ASSIGNED',
      }),
      markMatchingSessionConfirmed,
      markMatchingQueueConfirmed,
      createMedicalContract: jest.fn().mockImplementation(async (data) => ({
        id: 'contract-linked-1',
        ...data,
        familyUnit: mockFamily,
        facility: mockFacility,
        doctor: mockDoctor,
        servicePackage: mockPackage,
      })),
      recordChange: jest.fn().mockResolvedValue(undefined),
    };

    const service = new ContractsServiceImpl({
      transaction: jest.fn().mockImplementation(async (cb) => cb(sessionMock as any)),
    });

    await service.createInitialMedicalContract(familyRepUser, {
      packageId: 'pkg-1',
      memberCount: 4,
      matchingSessionId: 'match-sess-1',
    });
    expect(markMatchingSessionConfirmed).toHaveBeenCalledWith(
      'match-sess-1',
      'contract-linked-1',
    );

    await service.createInitialMedicalContract(familyRepUser, {
      packageId: 'pkg-1',
      memberCount: 4,
      queueRequestId: 'queue-req-1',
    });
    expect(markMatchingQueueConfirmed).toHaveBeenCalledWith(
      'queue-req-1',
      'contract-linked-1',
    );
  });

  it('rejects memberCount exceeding package maxMembers', async () => {
    const sessionMock = {
      findPackage: jest.fn().mockResolvedValue(mockPackage),
      lockDoctorAndCountActiveAndHeld: jest.fn().mockResolvedValue({
        doctor: mockDoctor,
        activeAndHeldCount: 2,
      }),
      findFacilityById: jest.fn().mockResolvedValue(mockFacility),
      findActiveStaffingContract: jest
        .fn()
        .mockResolvedValue({ id: 'staff-1', status: 'ACTIVE' }),
      findFamilyById: jest.fn().mockResolvedValue(mockFamily),
    };

    const service = new ContractsServiceImpl({
      transaction: jest.fn().mockImplementation(async (cb) => cb(sessionMock as any)),
    });

    await expect(
      service.createInitialMedicalContract(familyRepUser, {
        packageId: 'pkg-1',
        doctorId: 'doc-1',
        memberCount: 8,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('allows family #3 when panel 2/5 (no monthly-slot cap any more)', async () => {
    const pkg1m8 = {
      ...mockPackage,
      durationMonths: 1,
      periodicVisitsQuota: 8,
    };
    const createMedicalContract = jest.fn().mockImplementation(async (data) => ({
      id: 'contract-fam3',
      ...data,
      familyUnit: mockFamily,
      facility: mockFacility,
      doctor: { ...mockDoctor, maxPanelCapacity: 5 },
      servicePackage: pkg1m8,
    }));
    const sessionMock = {
      findPackage: jest.fn().mockResolvedValue(pkg1m8),
      lockDoctorAndCountActiveAndHeld: jest.fn().mockResolvedValue({
        doctor: { ...mockDoctor, maxPanelCapacity: 5 },
        activeAndHeldCount: 2,
      }),
      findFacilityById: jest.fn().mockResolvedValue(mockFacility),
      findActiveStaffingContract: jest.fn().mockResolvedValue({ id: 'staff-1', status: 'ACTIVE' }),
      findFamilyById: jest.fn().mockResolvedValue(mockFamily),
      createMedicalContract,
      recordChange: jest.fn().mockResolvedValue(undefined),
    };

    const service = new ContractsServiceImpl({
      transaction: jest.fn().mockImplementation(async (cb) => cb(sessionMock as any)),
    });

    const created = await service.createInitialMedicalContract(familyRepUser, {
      packageId: 'pkg-1',
      doctorId: 'doc-1',
      memberCount: 4,
    });
    expect(created.id).toBe('contract-fam3');
  });

  it('uses default maxPanelCapacity = 5 when doctor.maxPanelCapacity is null/0', async () => {
    const sessionMock = {
      findPackage: jest.fn().mockResolvedValue(mockPackage),
      lockDoctorAndCountActiveAndHeld: jest.fn().mockResolvedValue({
        doctor: { ...mockDoctor, maxPanelCapacity: null },
        activeAndHeldCount: 5,
      }),
    };

    const service = new ContractsServiceImpl({
      transaction: jest.fn().mockImplementation(async (cb) => cb(sessionMock as any)),
    });

    await expect(
      service.createInitialMedicalContract(familyRepUser, {
        packageId: 'pkg-1',
        doctorId: 'doc-1',
        memberCount: 4,
      }),
    ).rejects.toThrow(ConflictException);
  });
});
