import { ConflictException } from '@nestjs/common';
import { ContractsServiceImpl } from '../services/impl/contracts.service.impl';

const mockPackage = {
  id: 'pkg-1',
  lineageCode: 'PKG-STANDARD',
  version: 1,
  packageName: 'Gói Đồng Hành',
  description: 'Chăm sóc gia đình',
  durationMonths: 1,
  basePrice: '1000000',
  includedMembers: 4,
  maxMembers: 6,
  additionalMemberMonthlyPrice: '75000',
  quotaPeriod: 'PER_TERM',
  periodicVisitsQuota: 2,
  telehealthQuota: 2,
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
  activePanelCount: 1,
  maxPanelCapacity: 5,
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
const familyRep = {
  id: 'user-rep-1',
  role: 'FAMILY_REP',
  familyUnitId: 'fam-uuid-1',
};

function buildService(opts: {
  occupied?: Array<{ date: string; slotWindow: 'MORNING' | 'AFTERNOON' }>;
  holdError?: Error;
  openContract?: { id: string; contractStatus: string } | null;
}) {
  const tx = { __tx: true };
  const slotLedger = {
    listOccupied: jest.fn().mockResolvedValue(opts.occupied ?? []),
    listFamilyBusyDates: jest.fn().mockResolvedValue([]),
    hold: jest.fn().mockImplementation(async () => {
      if (opts.holdError) throw opts.holdError;
    }),
  };
  const createMedicalContract = jest.fn().mockImplementation(async (data) => ({
    id: 'contract-1',
    ...data,
    familyUnit: mockFamily,
    facility: mockFacility,
    doctor: mockDoctor,
    servicePackage: mockPackage,
  }));
  const session = {
    getTx: () => tx,
    findPackage: jest.fn().mockResolvedValue(mockPackage),
    lockDoctorAndCountActiveAndHeld: jest.fn().mockResolvedValue({
      doctor: mockDoctor,
      activeAndHeldCount: 1,
    }),
    findFacilityById: jest.fn().mockResolvedValue(mockFacility),
    findActiveStaffingContract: jest
      .fn()
      .mockResolvedValue({ id: 'staff-1', status: 'ACTIVE' }),
    findFamilyById: jest.fn().mockResolvedValue(mockFamily),
    createMedicalContract,
    findOpenContractForFamily: jest
      .fn()
      .mockResolvedValue(opts.openContract ?? null),
    recordChange: jest.fn().mockResolvedValue(undefined),
  };
  const service = new ContractsServiceImpl(
    {
      transaction: jest.fn().mockImplementation(async (cb) => cb(session as any)),
    } as any,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    slotLedger as any,
  );
  return { service, slotLedger, createMedicalContract, tx };
}

describe('mua gói → lập kế hoạch và giữ chỗ ca', () => {
  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-12-01T03:00:00.000Z'));
  });
  afterAll(() => jest.useRealTimers());

  it('đủ ngày → chỉ hold 2 ca khám tại nhà (video do gia đình tự đặt), hết hạn sau 24h', async () => {
    const { service, slotLedger, createMedicalContract, tx } = buildService({});
    await service.createInitialMedicalContract(familyRep as any, {
      packageId: 'pkg-1',
      doctorId: 'doc-1',
      memberCount: 4,
    } as any);

    expect(createMedicalContract).toHaveBeenCalledTimes(1);
    expect(slotLedger.hold).toHaveBeenCalledTimes(1);
    const [passedTx, input] = slotLedger.hold.mock.calls[0];
    expect(passedTx).toBe(tx);
    expect(input.doctorId).toBe('doc-1');
    expect(input.contractId).toBe('contract-1');
    expect(input.slots).toHaveLength(2);
    expect(
      input.slots.every((s: any) => s.visitType === 'HOME_VISIT'),
    ).toBe(true);
    expect(input.expiresAt.getTime()).toBe(
      new Date('2026-12-02T03:00:00.000Z').getTime(),
    );
  });

  it('bác sĩ kín lịch → DOCTOR_SCHEDULE_FULL và không tạo hợp đồng', async () => {
    const days: string[] = [];
    for (let d = 2; d <= 31; d++) {
      days.push(`2026-12-${String(d).padStart(2, '0')}`);
    }
    const occupied = days.flatMap((date) => [
      { date, slotWindow: 'MORNING' as const },
      { date, slotWindow: 'AFTERNOON' as const },
    ]);
    const { service, createMedicalContract, slotLedger } = buildService({
      occupied,
    });

    await expect(
      service.createInitialMedicalContract(familyRep as any, {
        packageId: 'pkg-1',
        doctorId: 'doc-1',
        memberCount: 4,
      } as any),
    ).rejects.toMatchObject({
      errorCode: 'DOCTOR_SCHEDULE_FULL',
      conditions: [expect.objectContaining({ code: 'HOME_SLOT_CAPACITY' })],
    });
    expect(createMedicalContract).not.toHaveBeenCalled();
    expect(slotLedger.hold).not.toHaveBeenCalled();
  });

  it('hold báo SLOT_TAKEN → lỗi nổi lên để transaction rollback', async () => {
    const taken = new ConflictException({ code: 'SLOT_TAKEN' });
    const { service } = buildService({ holdError: taken });
    await expect(
      service.createInitialMedicalContract(familyRep as any, {
        packageId: 'pkg-1',
        doctorId: 'doc-1',
        memberCount: 4,
      } as any),
    ).rejects.toBe(taken);
  });

  it('gia đình đã có gói đang mở → FAMILY_ALREADY_HAS_OPEN_CONTRACT, không tạo hợp đồng/hold', async () => {
    const { service, slotLedger, createMedicalContract } = buildService({
      openContract: { id: 'old-contract', contractStatus: 'PENDING_PAYMENT' },
    });
    await expect(
      service.createInitialMedicalContract(familyRep as any, {
        packageId: 'pkg-1',
        doctorId: 'doc-1',
        memberCount: 4,
      } as any),
    ).rejects.toMatchObject({
      response: { code: 'FAMILY_ALREADY_HAS_OPEN_CONTRACT' },
    });
    expect(createMedicalContract).not.toHaveBeenCalled();
    expect(slotLedger.hold).not.toHaveBeenCalled();
  });
});
