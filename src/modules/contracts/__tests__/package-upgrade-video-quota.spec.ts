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
    version: 1,
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
    createdAt: new Date('2026-01-01Z'),
    updatedAt: new Date('2026-01-01Z'),
  };
  const payload = { packageId: newPackage.id, kind: 'UPGRADE' as const };
  const old = {
    id: 'old-contract',
    familyId: 'family',
    facilityId: 'facility',
    doctorId: 'doctor',
    contractStatus: 'EXPIRED',
    endDate: new Date('2026-01-01Z'),
    isDemo: true,
    billingSnapshot: {
      package: { durationMonths: 3 },
      members: { requestedCount: 4 },
      pricing: { totalPriceVnd: 3_000_000 },
      benefits: { quotas: { videoConsultations: 10 } },
    },
  };
  const session = {
    findContractForUpdate: jest.fn(),
    findOpenUpgrade: jest.fn(),
    hasOtherActiveContract: jest.fn(),
    findPackage: jest.fn(),
    countFamilyMembers: jest.fn(),
    createUpgrade: jest.fn(
      (data: Prisma.MedicalContractUncheckedCreateInput) => ({
        id: 'new-contract',
        ...data,
      }),
    ),
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
    session.countFamilyMembers.mockResolvedValue(4);
  });

  it('yêu cầu số lượt đã thỏa thuận và lưu vào hợp đồng lẫn điều khoản', async () => {
    await expect(
      service.createPackageUpgradeContract(actor, old.id, payload),
    ).rejects.toMatchObject({ status: 400 });
    expect(session.createUpgrade).not.toHaveBeenCalled();

    const request = { ...payload, videoConsultations: 24 };
    await expect(
      service.createPackageUpgradeContract(actor, old.id, request),
    ).resolves.toMatchObject({ remainingTelehealth: 24 });
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
    session.findPackage.mockResolvedValue({
      ...newPackage,
      videoQuotaPolicy: 'FIXED',
      telehealthQuota: 20,
    });
    await expect(
      service.createPackageUpgradeContract(actor, old.id, {
        ...payload,
        videoConsultations: 20,
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(session.createUpgrade).not.toHaveBeenCalled();
  });
});
