import type { Prisma } from '@prisma/client';
import type {
  ContractsSession,
  IContractsRepository,
} from '../repositories/interfaces/contracts.repository.interface';
import { ContractsServiceImpl } from '../services/impl/contracts.service.impl';

describe('Số lượt video khi nâng gói (UC-18)', () => {
  const actor = { id: 'admin', role: 'ADMIN' as const, familyUnitId: null };
  const newPackage = {
    id: 'new-package',
    lineageCode: 'ANNUAL',
    version: 2,
    packageName: 'Gói năm',
    durationMonths: 12,
    basePrice: 12_000_000,
    includedMembers: 4,
    maxMembers: 6,
    additionalMemberMonthlyPrice: 0,
    quotaPeriod: 'PER_TERM',
    videoQuotaPolicy: 'CONTRACT',
    telehealthQuota: 0,
    periodicVisitsQuota: 12,
    status: 'ACTIVE',
    deletedAt: null,
    createdAt: new Date('2026-01-01Z'),
    updatedAt: new Date('2026-01-01Z'),
  };
  const payload = { packageId: newPackage.id, kind: 'RENEWAL' as const };
  const old = {
    id: 'old-contract',
    contractNumber: 'MC-OLD',
    familyId: 'family',
    facilityId: 'facility',
    doctorId: 'doctor',
    packageId: 'old-package',
    contractStatus: 'EXPIRED',
    startDate: new Date('2025-01-01Z'),
    endDate: new Date(Date.now() - 2 * 86_400_000),
    isDemo: true,
    billingSnapshot: {
      package: { code: 'ANNUAL', durationMonths: 12 },
      members: { requestedCount: 4 },
      pricing: { totalPriceVnd: 12_000_000 },
      benefits: { quotas: { videoConsultations: 10 } },
    },
  };
  const session = {
    findContractForUpdate: jest.fn(),
    findOpenUpgrade: jest.fn(),
    hasOtherActiveContract: jest.fn(),
    findPackage: jest.fn(),
    findActivePackageByLineage: jest.fn(),
    countFamilyMembers: jest.fn(),
    findActivePatientsByFamilyId: jest.fn(),
    createUpgrade: jest.fn(
      (data: Prisma.MedicalContractUncheckedCreateInput) => ({
        id: 'new-contract',
        ...data,
      }),
    ),
    createContractMembers: jest.fn().mockResolvedValue(undefined),
    saveUpgradeSignature: jest.fn().mockResolvedValue({ id: 'sig-1' }),
    recordChange: jest.fn(),
  };
  const repository: IContractsRepository = {
    transaction: (work) => work(session as unknown as ContractsSession),
  };
  const service = new ContractsServiceImpl(repository);

  beforeEach(() => {
    jest.clearAllMocks();
    session.findContractForUpdate.mockResolvedValue(old);
    session.findOpenUpgrade.mockResolvedValue(null);
    session.hasOtherActiveContract.mockResolvedValue(false);
    session.findPackage.mockResolvedValue(newPackage);
    session.findActivePackageByLineage.mockResolvedValue(newPackage);
    session.countFamilyMembers.mockResolvedValue(4);
    session.findActivePatientsByFamilyId.mockResolvedValue([
      { id: 'p1', fullName: 'A', dateOfBirth: new Date(), gender: 'MALE', relationshipToRep: 'SELF' },
      { id: 'p2', fullName: 'B', dateOfBirth: new Date(), gender: 'FEMALE', relationshipToRep: 'SPOUSE' },
      { id: 'p3', fullName: 'C', dateOfBirth: new Date(), gender: 'MALE', relationshipToRep: 'CHILD' },
      { id: 'p4', fullName: 'D', dateOfBirth: new Date(), gender: 'FEMALE', relationshipToRep: 'CHILD' },
    ]);
  });

  it('yêu cầu số lượt đã thỏa thuận và tạo kỳ gia hạn ở trạng thái PENDING_PAYMENT (R6–R8)', async () => {
    await expect(
      service.createPackageUpgradeContract(actor, old.id, payload),
    ).rejects.toMatchObject({ status: 400 });
    expect(session.createUpgrade).not.toHaveBeenCalled();

    const request = { ...payload, videoConsultations: 24 };
    await expect(
      service.createPackageUpgradeContract(actor, old.id, request),
    ).resolves.toMatchObject({
      remainingTelehealth: 24,
      contractStatus: 'PENDING_PAYMENT',
    });
    const [created] = session.createUpgrade.mock.results;
    expect(created.value.billingSnapshot).toMatchObject({
      benefits: {
        videoQuotaConfirmed: true,
        quotas: { videoConsultations: 24 },
      },
    });

    session.findOpenUpgrade.mockResolvedValue(created.value);
    await expect(
      service.createPackageUpgradeContract(actor, old.id, request),
    ).resolves.toMatchObject({ id: 'new-contract' });
    await expect(
      service.createPackageUpgradeContract(actor, old.id, {
        ...request,
        videoConsultations: 25,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(session.createUpgrade).toHaveBeenCalledTimes(1);
  });

  it('từ chối số lượt video tùy chỉnh với gói có hạn mức cố định', async () => {
    const fixedPkg = {
      ...newPackage,
      videoQuotaPolicy: 'FIXED',
      telehealthQuota: 20,
    };
    session.findPackage.mockResolvedValue(fixedPkg);
    session.findActivePackageByLineage.mockResolvedValue(fixedPkg);
    await expect(
      service.createPackageUpgradeContract(actor, old.id, {
        ...payload,
        videoConsultations: 20,
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(session.createUpgrade).not.toHaveBeenCalled();
  });
});
