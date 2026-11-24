import { BadRequestException } from '@nestjs/common';
import { EncounterStatus, EncounterType, EncounterVisitScope } from '@prisma/client';
import { EncountersServiceImpl } from '../services/impl/encounters.service.impl';

describe('Video Consultation Booking & Approval Lifecycle', () => {
  const buildService = (overrides: Record<string, any> = {}) => {
    const session = {
      findContract: jest.fn(),
      isPatientInContract: jest.fn().mockResolvedValue(true),
      findDoctorByUserId: jest.fn().mockResolvedValue({ id: 'doc-1' }),
      holdTelehealthQuota: jest.fn().mockResolvedValue(undefined),
      releaseTelehealthQuota: jest.fn().mockResolvedValue(undefined),
      commitHeldTelehealthQuota: jest.fn().mockResolvedValue(undefined),
      refundTelehealthQuota: jest.fn().mockResolvedValue(undefined),
      decrementContractQuota: jest.fn().mockResolvedValue(undefined),
      createEncounter: jest.fn().mockImplementation(async (data) => ({
        id: 'enc-1',
        category: 'AD_HOC_ON_DEMAND',
        ...data,
      })),
      findEncounter: jest.fn(),
      updateEncounter: jest.fn().mockImplementation(async (id, data) => ({
        id,
        category: 'AD_HOC_ON_DEMAND',
        encounterType: EncounterType.TELEHEALTH,
        scheduledDate: new Date('2099-12-01T00:00:00.000Z'),
        scheduledTime: new Date('1970-01-01T09:30:00.000Z'),
        ...data,
      })),
      findDoctorOverlappingEncounters: jest.fn().mockResolvedValue([]),
      createAuditLog: jest.fn().mockResolvedValue(undefined),
      createNotification: jest.fn().mockResolvedValue(undefined),
      createNotifications: jest.fn().mockResolvedValue(undefined),
      tx: {
        $executeRaw: jest.fn().mockResolvedValue(1),
        encounter: { count: jest.fn().mockResolvedValue(0) },
      },
      ...overrides,
    };
    const repo = {
      transaction: jest.fn().mockImplementation((fn: any) => fn(session)),
    };
    return { service: new EncountersServiceImpl(repo as any), session };
  };

  it('cho phép đặt Tư vấn Video mặc định cả hộ, bỏ trống lý do và tạm giữ 1 lượt gói FIXED', async () => {
    const { service, session } = buildService({
      findContract: jest.fn().mockResolvedValue({
        id: 'ctr-1',
        contractStatus: 'ACTIVE',
        doctorId: 'doc-1',
        remainingTelehealth: 3,
        heldTelehealth: 0,
        servicePackage: { videoQuotaPolicy: 'FIXED' },
        familyUnit: { representativeUserId: 'user-fam' },
        doctor: { user: { id: 'user-doc' } },
        members: [{ patientId: 'p-1' }, { patientId: 'p-2' }],
      }),
    });

    const res = await service.createAdHocEncounter(
      { id: 'user-fam', role: 'FAMILY_REP' } as any,
      {
        contractId: 'ctr-1',
        encounterType: EncounterType.TELEHEALTH,
        desiredDate: '2099-12-01',
        slotWindow: 'MORNING',
        quickTags: ['Hỏi thuốc'],
      } as any,
    );

    expect(session.holdTelehealthQuota).toHaveBeenCalledWith('ctr-1');
    expect(session.createEncounter).toHaveBeenCalledWith(
      expect.objectContaining({
        visitScope: EncounterVisitScope.FAMILY,
        slotWindow: 'MORNING',
        encounterStatus: EncounterStatus.REQUESTED,
      }),
    );
    expect(res.displayNotes).toContain('[Hỏi thuốc]');
  });

  it('cho phép gói UNLIMITED đặt lịch ngay cả khi remainingTelehealth === 0', async () => {
    const { service, session } = buildService({
      findContract: jest.fn().mockResolvedValue({
        id: 'ctr-unl',
        contractStatus: 'ACTIVE',
        doctorId: 'doc-1',
        remainingTelehealth: 0,
        heldTelehealth: 0,
        servicePackage: { videoQuotaPolicy: 'UNLIMITED' },
        familyUnit: { representativeUserId: 'user-fam' },
        doctor: { user: { id: 'user-doc' } },
        members: [{ patientId: 'p-1' }],
      }),
    });

    await expect(
      service.createAdHocEncounter(
        { id: 'user-fam', role: 'FAMILY_REP' } as any,
        {
          contractId: 'ctr-unl',
          encounterType: EncounterType.TELEHEALTH,
          desiredDate: '2099-12-01',
          slotWindow: 'AFTERNOON',
        } as any,
      ),
    ).resolves.toBeDefined();
    expect(session.holdTelehealthQuota).not.toHaveBeenCalled();
  });

  it('từ chối khi gói FIXED đã hết lượt khả dụng (remaining - held <= 0)', async () => {
    const { service } = buildService({
      findContract: jest.fn().mockResolvedValue({
        id: 'ctr-empty',
        contractStatus: 'ACTIVE',
        doctorId: 'doc-1',
        remainingTelehealth: 1,
        heldTelehealth: 1,
        servicePackage: { videoQuotaPolicy: 'FIXED' },
        familyUnit: { representativeUserId: 'user-fam' },
        members: [{ patientId: 'p-1' }],
      }),
    });

    await expect(
      service.createAdHocEncounter(
        { id: 'user-fam', role: 'FAMILY_REP' } as any,
        {
          contractId: 'ctr-empty',
          encounterType: EncounterType.TELEHEALTH,
          desiredDate: '2099-12-01',
          slotWindow: 'MORNING',
        } as any,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('cho phép Bác sĩ duyệt 1 chạm từ AWAITING_DOCTOR_REVIEW sang CONFIRMED kèm giờ chốt', async () => {
    const { service, session } = buildService({
      findEncounter: jest.fn().mockResolvedValue({
        id: 'enc-1',
        contractId: 'ctr-1',
        doctorId: 'doc-1',
        encounterType: EncounterType.TELEHEALTH,
        category: 'AD_HOC_ON_DEMAND',
        encounterStatus: EncounterStatus.REQUESTED,
        scheduledDate: new Date('2099-12-01T00:00:00.000Z'),
        scheduledTime: new Date('1970-01-01T08:00:00.000Z'),
        cancelReason: '[SCHEDULE_META:{"stage":"AWAITING_DOCTOR_REVIEW"}] Tư vấn',
        participants: [],
        doctor: { doctorName: 'BS A', user: { id: 'user-doc' } },
        contract: {
          remainingTelehealth: 2,
          servicePackage: { videoQuotaPolicy: 'FIXED' },
          familyUnit: {
            representativeUserId: 'user-fam',
            representativeUser: { fullName: 'Tuấn' },
          },
          facility: { user: { id: 'user-fac' }, userId: 'user-fac' },
        },
      }),
    });

    const res = await service.confirmEncounter(
      { id: 'user-doc', role: 'DOCTOR' } as any,
      'enc-1',
      { confirmed: true, confirmedTime: '09:30' } as any,
    );

    expect(session.commitHeldTelehealthQuota).toHaveBeenCalledWith('ctr-1');
    expect(res.encounterStatus).toBe(EncounterStatus.CONFIRMED);
  });

  it('hoàn trả 1 lượt khi Gia đình hủy lịch CONFIRMED trước giờ hẹn >= 2 giờ', async () => {
    const { service, session } = buildService({
      findEncounter: jest.fn().mockResolvedValue({
        id: 'enc-1',
        contractId: 'ctr-1',
        doctorId: 'doc-1',
        encounterType: EncounterType.TELEHEALTH,
        category: 'AD_HOC_ON_DEMAND',
        encounterStatus: EncounterStatus.CONFIRMED,
        scheduledDate: new Date('2099-12-01T00:00:00.000Z'),
        scheduledTime: new Date('1970-01-01T09:30:00.000Z'),
        contract: {
          familyUnit: { representativeUserId: 'user-fam' },
        },
      }),
    });

    const res = await service.cancelEncounter(
      { id: 'user-fam', role: 'FAMILY_REP' } as any,
      'enc-1',
      'Gia đình bận đột xuất',
    );

    expect(session.refundTelehealthQuota).toHaveBeenCalledWith('ctr-1');
    expect(res.refunded).toBe(true);
    expect(res.encounterStatus).toBe(EncounterStatus.CANCELLED);
  });
});
