import { BadRequestException, ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type {
  ContractsSession,
  IContractsRepository,
} from '../repositories/interfaces/contracts.repository.interface';
import { ContractsServiceImpl } from '../services/impl/contracts.service.impl';

describe('Contract Renewal Workflow (R1–R9)', () => {
  const actor = {
    id: 'user-family-1',
    role: 'FAMILY_REP' as const,
    familyUnitId: 'family-1',
  };

  const basePkg = {
    id: 'pkg-1',
    lineageCode: 'GOI_3_THANG',
    version: 2,
    packageName: 'Gói Chăm Sóc Gia Đình 3 Tháng',
    description: 'Mô tả gói',
    durationMonths: 3,
    basePrice: 3_500_000,
    includedMembers: 4,
    maxMembers: 6,
    additionalMemberMonthlyPrice: 200_000,
    quotaPeriod: 'PER_TERM',
    videoQuotaPolicy: 'FIXED',
    telehealthQuota: 20,
    periodicVisitsQuota: 3,
    status: 'ACTIVE',
    deletedAt: null,
    publishedAt: new Date('2026-01-01T00:00:00.000Z'),
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  const activePatients = [
    {
      id: 'pat-1',
      fullName: 'Nguyễn Văn A',
      dateOfBirth: new Date('1985-05-10T00:00:00.000Z'),
      gender: 'MALE',
      relationshipToRep: 'SELF',
    },
    {
      id: 'pat-2',
      fullName: 'Trần Thị B',
      dateOfBirth: new Date('1988-08-20T00:00:00.000Z'),
      gender: 'FEMALE',
      relationshipToRep: 'SPOUSE',
    },
  ];

  function makeOldContract(overrides: Record<string, unknown> = {}) {
    return {
      id: 'old-ctr-1',
      contractNumber: 'MC-OLD-001',
      familyId: 'family-1',
      facilityId: 'facility-1',
      doctorId: 'doctor-1',
      packageId: 'pkg-old-v1',
      totalAmount: 3_000_000,
      remainingHomeVisits: 2,
      remainingTelehealth: 9,
      startDate: new Date('2026-09-11T00:00:00.000Z'),
      endDate: new Date('2026-12-10T00:00:00.000Z'),
      contractStatus: 'ACTIVE',
      upgradedFromId: null,
      memberCount: 2,
      isDemo: false,
      documensoEnvelopeId: 'env-old',
      documensoItemId: 'item-old',
      familyUnit: {
        id: 'family-1',
        representativeUserId: 'user-family-1',
        homeAddress: '123 Nguyễn Huệ, Q1',
        emergencyPhone: '0901234567',
      },
      facility: {
        id: 'facility-1',
        userId: 'user-fac-1',
        facilityName: 'Phòng khám Gia Đình',
        operationalStatus: 'ACTIVE',
      },
      doctor: {
        id: 'doctor-1',
        userId: 'user-doc-1',
        fullName: 'BS. Lê Văn C',
        onboardingStatus: 'ACTIVE',
        maxPanelCapacity: 5,
        user: { id: 'user-doc-1', fullName: 'BS. Lê Văn C' },
      },
      servicePackage: basePkg,
      billingSnapshot: {
        package: {
          id: 'pkg-old-v1',
          code: 'GOI_3_THANG',
          name: 'Gói Chăm Sóc Gia Đình 3 Tháng',
          durationMonths: 3,
        },
        members: { requestedCount: 2 },
        pricing: { totalPriceVnd: 3_000_000 },
        benefits: { quotas: { homeVisits: 3, videoConsultations: 20 } },
      },
      ...overrides,
    };
  }

  function makeSession() {
    const session: Record<string, jest.Mock> = {
      findContractForUpdate: jest.fn(),
      findOpenUpgrade: jest.fn(),
      hasOtherActiveContract: jest.fn(),
      findPackage: jest.fn(),
      findActivePackageByLineage: jest.fn(),
      countFamilyMembers: jest.fn(),
      findActivePatientsByFamilyId: jest.fn(),
      findPendingTermination: jest.fn(),
      hasPendingMemberAddendum: jest.fn(),
      getRenewalGraceDays: jest.fn(),
      lockDoctorAndCountActiveAndHeld: jest.fn(),
      createUpgrade: jest.fn((data: Prisma.MedicalContractUncheckedCreateInput) => ({
        ...makeOldContract(),
        id: 'new-renewal-1',
        ...data,
      })),
      createContractMembers: jest.fn().mockResolvedValue(undefined),
      saveUpgradeSignature: jest.fn().mockResolvedValue({ id: 'sig-1' }),
      updateContractStatus: jest.fn().mockResolvedValue(undefined),
      findContractSignatures: jest.fn().mockResolvedValue([]),
      findChildRenewalsBySourceId: jest.fn().mockResolvedValue([]),
      cancelUnpaidRights: jest.fn().mockResolvedValue(undefined),
      cancelPendingInvoices: jest.fn().mockResolvedValue(undefined),
      hasPaidInvoice: jest.fn().mockResolvedValue(false),
      hasEncounterInProgress: jest.fn().mockResolvedValue(false),
      updateTermination: jest.fn().mockResolvedValue({ id: 'term-1', status: 'APPROVED' }),
      findTermination: jest.fn(),
      refreshDoctorPanel: jest.fn().mockResolvedValue(undefined),
      recordChange: jest.fn().mockResolvedValue(undefined),
    };
    return session;
  }

  let session: ReturnType<typeof makeSession>;
  let service: ContractsServiceImpl;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-26T05:00:00.000Z')); // 12:00 VN
    session = makeSession();
    const repository: IContractsRepository = {
      transaction: (work) => work(session as unknown as ContractsSession),
    };
    service = new ContractsServiceImpl(repository);

    session.findContractForUpdate.mockResolvedValue(makeOldContract());
    session.findOpenUpgrade.mockResolvedValue(null);
    session.hasOtherActiveContract.mockResolvedValue(false);
    session.findPackage.mockResolvedValue(basePkg);
    session.findActivePackageByLineage.mockResolvedValue(basePkg);
    session.countFamilyMembers.mockResolvedValue(2);
    session.findActivePatientsByFamilyId.mockResolvedValue(activePatients);
    session.findPendingTermination.mockResolvedValue(null);
    session.hasPendingMemberAddendum.mockResolvedValue(false);
    session.getRenewalGraceDays.mockResolvedValue(7);
    session.lockDoctorAndCountActiveAndHeld.mockResolvedValue({
      doctor: {
        id: 'doctor-1',
        onboardingStatus: 'ACTIVE',
        maxPanelCapacity: 5,
        user: { fullName: 'BS. Lê Văn C' },
      },
      activeAndHeldCount: 2,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('Case A (ACTIVE): getRenewalPreview trả về nối tiếp endDate cũ + 1, giá hiện hành, thành viên ACTIVE và không cộng dồn lượt dư', async () => {
    const preview = await (service as any).getRenewalPreview(actor, 'old-ctr-1');

    expect(preview.eligible).toBe(true);
    expect(preview.caseType).toBe('CASE_A');
    expect(preview.expectedStartDate).toBe('2026-12-11');
    expect(preview.expectedEndDate).toBe('2027-03-11');
    expect(preview.pricing.totalPriceVnd).toBe(3_500_000);
    expect(preview.members).toHaveLength(2);
    expect(preview.package.quotas.homeVisits).toBe(3);
    expect(preview.package.quotas.videoConsultations).toBe(20);
    expect(preview.termsHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('Case A (ACTIVE): confirmContractRenewal tạo kỳ mới PENDING_PAYMENT, không Documenso, lưu 1 chữ ký FAMILY_REP, không đổi trạng thái kỳ cũ', async () => {
    const preview = await (service as any).getRenewalPreview(actor, 'old-ctr-1');
    const created = await (service as any).confirmContractRenewal(
      actor,
      'old-ctr-1',
      { acceptedTerms: true, termsHash: preview.termsHash },
      '10.0.0.1',
    );

    expect(created.contractStatus).toBe('PENDING_PAYMENT');
    expect(created.upgradedFromId).toBe('old-ctr-1');
    expect(created.documensoEnvelopeId).toBeNull();
    expect(created.remainingHomeVisits).toBe(3);
    expect(created.remainingTelehealth).toBe(20);
    expect(session.updateContractStatus).not.toHaveBeenCalled();
    expect(session.createContractMembers).toHaveBeenCalledWith('new-renewal-1', ['pat-1', 'pat-2']);
    expect(session.saveUpgradeSignature).toHaveBeenCalledWith(
      expect.objectContaining({
        contractId: 'new-renewal-1',
        signerRole: 'FAMILY_REP',
        ipAddress: '10.0.0.1',
      }),
    );
    const [createArg] = session.createUpgrade.mock.calls[0];
    expect(createArg.billingSnapshot).toMatchObject({
      renewalConfirmation: {
        confirmedByUserId: 'user-family-1',
        ipAddress: '10.0.0.1',
        termsHash: preview.termsHash,
      },
    });
    expect(createArg.holdExpiresAt).toEqual(new Date('2026-11-27T05:00:00.000Z'));
  });

  it('Case B (EXPIRED trong ân hạn): getRenewalPreview trả về CASE_B và confirmContractRenewal cắt holdExpiresAt không vượt cuối ngày cuối ân hạn (R9)', async () => {
    session.findContractForUpdate.mockResolvedValue(
      makeOldContract({
        contractStatus: 'EXPIRED',
        endDate: new Date('2026-11-22T00:00:00.000Z'), // grace ends 2026-11-29
      }),
    );
    // Hôm nay 2026-11-29 17:00 VN (= 10:00 UTC)
    jest.setSystemTime(new Date('2026-11-29T10:00:00.000Z'));

    const preview = await (service as any).getRenewalPreview(actor, 'old-ctr-1');
    expect(preview.eligible).toBe(true);
    expect(preview.caseType).toBe('CASE_B');
    expect(preview.expectedStartDate).toBe('2026-11-29');

    await (service as any).confirmContractRenewal(
      actor,
      'old-ctr-1',
      { acceptedTerms: true, termsHash: preview.termsHash },
      '10.0.0.2',
    );
    const [createArg] = session.createUpgrade.mock.calls[0];
    expect(createArg.holdExpiresAt).toEqual(new Date('2026-11-29T16:59:59.999Z'));
  });

  it('Chặn hợp đồng EXPIRED quá thời gian ân hạn với GRACE_PERIOD_EXPIRED và suggestBuyNew: true', async () => {
    session.findContractForUpdate.mockResolvedValue(
      makeOldContract({
        contractStatus: 'EXPIRED',
        endDate: new Date('2026-11-10T00:00:00.000Z'), // > 7 ngày
      }),
    );
    const preview = await (service as any).getRenewalPreview(actor, 'old-ctr-1');
    expect(preview.eligible).toBe(false);
    expect(preview.suggestBuyNew).toBe(true);
    expect(preview.blockingReasons.map((r: any) => r.code)).toContain('GRACE_PERIOD_EXPIRED');
  });

  it('Chặn hợp đồng TERMINATED (R4) và PENDING_* chưa kích hoạt', async () => {
    session.findContractForUpdate.mockResolvedValue(
      makeOldContract({ contractStatus: 'TERMINATED' }),
    );
    const terminated = await (service as any).getRenewalPreview(actor, 'old-ctr-1');
    expect(terminated.eligible).toBe(false);
    expect(terminated.suggestBuyNew).toBe(true);
    expect(terminated.blockingReasons.map((r: any) => r.code)).toContain('CONTRACT_TERMINATED');

    session.findContractForUpdate.mockResolvedValue(
      makeOldContract({ contractStatus: 'PENDING_PAYMENT' }),
    );
    const pending = await (service as any).getRenewalPreview(actor, 'old-ctr-1');
    expect(pending.eligible).toBe(false);
    expect(pending.suggestBuyNew).toBe(false);
    expect(pending.blockingReasons.map((r: any) => r.code)).toContain('CONTRACT_NOT_ACTIVE_YET');
  });

  it('Chặn 4 điều kiện bổ sung: đã có kỳ gia hạn, gói ngừng bán, bác sĩ nghỉ/đủ 5 gia đình, đang có yêu cầu chấm dứt/phụ lục', async () => {
    session.findOpenUpgrade.mockResolvedValueOnce({
      id: 'ren-open',
      contractNumber: 'MC-REN-1',
      contractStatus: 'PENDING_ACTIVATION',
    });
    let p = await (service as any).getRenewalPreview(actor, 'old-ctr-1');
    expect(p.eligible).toBe(false);
    expect(p.blockingReasons.map((r: any) => r.code)).toContain('RENEWAL_ALREADY_EXISTS');
    expect(p.existingRenewal).toMatchObject({ id: 'ren-open', contractStatus: 'PENDING_ACTIVATION' });

    session.findActivePackageByLineage.mockResolvedValueOnce(null);
    p = await (service as any).getRenewalPreview(actor, 'old-ctr-1');
    expect(p.eligible).toBe(false);
    expect(p.suggestBuyNew).toBe(true);
    expect(p.blockingReasons.map((r: any) => r.code)).toContain('PACKAGE_UNAVAILABLE');

    session.findContractForUpdate.mockResolvedValueOnce(
      makeOldContract({
        contractStatus: 'EXPIRED',
        endDate: new Date('2026-11-22T00:00:00.000Z'),
      }),
    );
    session.lockDoctorAndCountActiveAndHeld.mockResolvedValueOnce({
      doctor: { id: 'doctor-1', onboardingStatus: 'ACTIVE', maxPanelCapacity: 5 },
      activeAndHeldCount: 5,
    });
    p = await (service as any).getRenewalPreview(actor, 'old-ctr-1');
    expect(p.eligible).toBe(false);
    expect(p.suggestBuyNew).toBe(true);
    expect(p.blockingReasons.map((r: any) => r.code)).toContain('DOCTOR_PANEL_FULL');

    session.findPendingTermination.mockResolvedValueOnce({ id: 'term-1', status: 'PENDING' });
    session.hasPendingMemberAddendum.mockResolvedValueOnce(true);
    p = await (service as any).getRenewalPreview(actor, 'old-ctr-1');
    expect(p.eligible).toBe(false);
    expect(p.blockingReasons.map((r: any) => r.code)).toEqual(
      expect.arrayContaining(['PENDING_TERMINATION_REQUEST', 'PENDING_MEMBER_ADDENDUM']),
    );
  });

  it('R6 & R8: createPackageUpgradeContract từ chối đổi gói và signUpgradedContract chặn ký 4 bên trên kỳ gia hạn', async () => {
    await expect(
      service.createPackageUpgradeContract(actor, 'old-ctr-1', {
        packageId: 'other-pkg-id',
        kind: 'UPGRADE',
      }),
    ).rejects.toThrow(BadRequestException);

    session.findContractForUpdate.mockResolvedValueOnce(
      makeOldContract({
        id: 'new-renewal-1',
        upgradedFromId: 'old-ctr-1',
        contractStatus: 'PENDING_PAYMENT',
        documensoEnvelopeId: null,
        billingSnapshot: {
          package: { code: 'GOI_3_THANG' },
          renewalConfirmation: { confirmedByUserId: 'user-family-1' },
        },
      }),
    );
    await expect(
      service.signUpgradedContract(
        { id: 'admin-1', role: 'ADMIN', familyUnitId: null },
        'new-renewal-1',
        { acceptedTerms: true, termsHash: 'a'.repeat(64) },
        '127.0.0.1',
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('cancelDraftMedicalContract: kỳ gia hạn (upgradedFromId != null) chuyển CANCELLED; mua mới chuyển TERMINATED', async () => {
    session.findContractForUpdate.mockResolvedValue(
      makeOldContract({
        id: 'ren-draft-1',
        contractStatus: 'PENDING_PAYMENT',
        upgradedFromId: 'old-ctr-1',
      }),
    );
    const resRenewal = await service.cancelDraftMedicalContract(
      actor,
      'ren-draft-1',
      'Gia đình đổi ý',
    );
    expect(resRenewal.contractStatus).toBe('CANCELLED');
    expect(session.updateContractStatus).toHaveBeenCalledWith(
      'ren-draft-1',
      'CANCELLED',
      'Gia đình đổi ý',
    );

    session.updateContractStatus.mockClear();
    session.findContractForUpdate.mockResolvedValue(
      makeOldContract({
        id: 'new-draft-1',
        contractStatus: 'PENDING_PAYMENT',
        upgradedFromId: null,
      }),
    );
    const resNew = await service.cancelDraftMedicalContract(
      actor,
      'new-draft-1',
      'Hủy bản nháp',
    );
    expect(resNew.contractStatus).toBe('TERMINATED');
  });

  it('R10: terminateContract (APPROVE) hủy theo kỳ gia hạn PENDING_ACTIVATION sang CANCELLED và cho phép createRefundRequest', async () => {
    const termsHash = 'b'.repeat(64);
    session.findTermination.mockResolvedValueOnce({
      id: 'term-1',
      contractId: 'old-ctr-1',
      reason: 'Chuyển nơi ở',
      termsHash,
      status: 'PENDING',
      consents: [
        { role: 'FAMILY_REP', userId: 'user-family-1', termsHash },
        { role: 'HEALTHCARE_FACILITY', userId: 'user-fac-1', termsHash },
        { role: 'ASSIGNED_DOCTOR', userId: 'user-doc-1', termsHash },
      ],
    });
    session.findChildRenewalsBySourceId.mockResolvedValueOnce([
      makeOldContract({
        id: 'ren-pending-act',
        contractStatus: 'PENDING_ACTIVATION',
        upgradedFromId: 'old-ctr-1',
      }),
    ]);

    await service.terminateContract(
      { id: 'admin-1', role: 'ADMIN', familyUnitId: null },
      'old-ctr-1',
      { action: 'APPROVE', requestId: 'term-1', termsHash },
    );

    expect(session.updateContractStatus).toHaveBeenCalledWith(
      'ren-pending-act',
      'CANCELLED',
      'Hủy kỳ gia hạn chờ hiệu lực do hợp đồng kỳ hiện tại bị chấm dứt',
    );

    const mockPrisma: any = {
      $transaction: (fn: any) => fn(mockPrisma),
      medicalContract: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'ren-pending-act',
          contractStatus: 'CANCELLED',
          upgradedFromId: 'old-ctr-1',
          totalAmount: 3_500_000,
          creditTransferTarget: null,
          refundRequest: null,
        }),
      },
      contractRefundRequest: {
        create: jest.fn((args: any) => Promise.resolve({ id: 'rf-1', ...args.data })),
      },
    };
    const svcWithPrisma = new ContractsServiceImpl({
      prisma: mockPrisma,
      transaction: (w: any) => w(session as unknown as ContractsSession),
    } as any);
    const refund = await svcWithPrisma.createRefundRequest(actor, 'ren-pending-act', {
      bankName: 'Vietcombank',
      accountNumber: '0123456789',
      accountHolder: 'NGUYEN VAN A',
    });
    expect(refund.amountVnd).toBe(3_500_000);
  });
});
