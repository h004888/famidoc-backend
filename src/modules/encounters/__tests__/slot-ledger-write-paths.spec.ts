import { ConflictException } from '@nestjs/common';
import {
  EncounterCategory,
  EncounterStatus,
  EncounterType,
  RescheduleDecision,
} from '@prisma/client';
import { EncountersServiceImpl } from '../services/impl/encounters.service.impl';
import { EncounterRemindersService } from '../services/impl/encounter-reminders.service';
import type { SlotLedgerService } from '../../scheduling/slot-ledger.service';
import type { AuthenticatedUser } from '../../../core/auth/authenticated-request';

describe('Task 7: Encounter write paths through SlotLedgerService', () => {
  const doctorActor: AuthenticatedUser = {
    id: 'user-doc-1',
    role: 'DOCTOR',
    familyUnitId: null,
  } as AuthenticatedUser;

  const familyActor: AuthenticatedUser = {
    id: 'user-fam-1',
    role: 'FAMILY_REP',
    familyUnitId: null,
  } as AuthenticatedUser;

  function createLedgerMock() {
    return {
      listOccupied: jest.fn().mockResolvedValue([]),
      hold: jest.fn().mockResolvedValue(undefined),
      confirmContract: jest.fn().mockResolvedValue([]),
      attachEncounter: jest.fn().mockResolvedValue(undefined),
      book: jest.fn().mockResolvedValue(undefined),
      move: jest.fn().mockResolvedValue(undefined),
      releaseEncounter: jest.fn().mockResolvedValue(undefined),
      releaseContractHolds: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<SlotLedgerService>;
  }

  function createServiceWithMockSession(session: any, ledger: SlotLedgerService) {
    const repo = {
      transaction: jest.fn(async (cb: (s: any) => Promise<any>) => cb(session)),
    };
    return new EncountersServiceImpl(repo as any, ledger);
  }

  it('(a) doctorManualSchedule vào ca mà book ném SLOT_TAKEN → ConflictException SLOT_TAKEN, không cập nhật encounter', async () => {
    const ledger = createLedgerMock();
    (ledger.book as jest.Mock).mockRejectedValueOnce(
      new ConflictException({
        code: 'SLOT_TAKEN',
        message: 'Ca này vừa có người đặt, vui lòng chọn ca khác',
        date: '2099-05-11',
        slotWindow: 'MORNING',
      }),
    );

    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      encounter: { findMany: jest.fn().mockResolvedValue([]) },
      medicalContract: { findUnique: jest.fn().mockResolvedValue({ familyId: 'fam-1' }) },
    };
    const session = {
      tx,
      findEncounter: jest.fn().mockResolvedValue({
        id: 'enc-1',
        doctorId: 'doc-1',
        contractId: 'con-1',
        encounterType: EncounterType.HOME_VISIT,
        cancelReason: null,
      }),
      updateEncounter: jest.fn(),
      createAuditLog: jest.fn(),
    };

    const service = createServiceWithMockSession(session, ledger);
    const err = await service
      .doctorManualSchedule(doctorActor, 'enc-1', {
        proposedDate: '2099-05-11',
        slotWindow: 'MORNING',
      })
      .then(() => null, (e) => e);

    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getResponse()).toMatchObject({ code: 'SLOT_TAKEN' });
    expect(session.updateEncounter).not.toHaveBeenCalled();
  });

  it('(b) doctorManualSchedule VIDEO → book nhận slotWindow trọn ca (MORNING/AFTERNOON)', async () => {
    const ledger = createLedgerMock();
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      encounter: { findMany: jest.fn().mockResolvedValue([]) },
      medicalContract: { findUnique: jest.fn().mockResolvedValue({ familyId: 'fam-1' }) },
    };
    const session = {
      tx,
      findEncounter: jest.fn().mockResolvedValue({
        id: 'enc-vid-1',
        doctorId: 'doc-1',
        contractId: 'con-1',
        encounterType: EncounterType.TELEHEALTH,
        cancelReason: null,
      }),
      updateEncounter: jest.fn().mockResolvedValue({
        id: 'enc-vid-1',
        scheduledDate: new Date('2099-05-10T00:00:00.000Z'),
        scheduledTime: new Date('1970-01-01T13:30:00.000Z'),
        slotWindow: 'AFTERNOON',
        encounterStatus: EncounterStatus.CONFIRMED,
        cancelReason: null,
      }),
      createAuditLog: jest.fn(),
    };

    const service = createServiceWithMockSession(session, ledger);
    await service.doctorManualSchedule(doctorActor, 'enc-vid-1', {
      proposedDate: '2099-05-11',
      slotWindow: 'AFTERNOON',
    });

    expect(ledger.book).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        doctorId: 'doc-1',
        contractId: 'con-1',
        date: '2099-05-11',
        slotWindow: 'AFTERNOON',
        visitType: 'VIDEO',
        encounterId: 'enc-vid-1',
      }),
    );
  });

  it('(c) decideRescheduleRequest APPROVE → gọi move; move ném SLOT_TAKEN → encounter giữ ngày cũ', async () => {
    const ledger = createLedgerMock();
    const tx = {
      encounterRescheduleRequest: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      encounter: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const baseEncounter = {
      id: 'enc-res-1',
      doctorId: 'doc-1',
      contractId: 'con-1',
      encounterType: EncounterType.HOME_VISIT,
      scheduledDate: new Date('2099-05-10T00:00:00.000Z'),
      scheduledTime: new Date('1970-01-01T08:00:00.000Z'),
      doctor: { doctorName: 'BS A', user: { id: 'user-doc-1' } },
      contract: {
        familyUnit: { representativeUserId: 'user-fam-1' },
        facility: { user: { id: 'user-fac-1' } },
      },
    };
    const baseReq = {
      id: 'req-1',
      encounterId: 'enc-res-1',
      status: 'PENDING',
      proposedDate: new Date('2099-05-12T00:00:00.000Z'),
      proposedTime: new Date('1970-01-01T13:30:00.000Z'),
      familyDecision: RescheduleDecision.APPROVED,
      doctorDecision: RescheduleDecision.PENDING,
    };
    const session = {
      tx,
      findEncounter: jest.fn().mockResolvedValue(baseEncounter),
      findRescheduleRequestById: jest.fn().mockResolvedValue(baseReq),
      findDoctorByUserId: jest.fn().mockResolvedValue({ id: 'doc-1' }),
      findEncounters: jest.fn().mockResolvedValue([[], 0]),
      updateEncounter: jest.fn().mockResolvedValue({}),
      updateRescheduleRequest: jest.fn().mockResolvedValue({ ...baseReq, status: 'APPROVED' }),
      createAuditLog: jest.fn(),
      createNotifications: jest.fn(),
    };

    const service = createServiceWithMockSession(session, ledger);

    // Trường hợp move thành công
    await service.decideRescheduleRequest(doctorActor, 'enc-res-1', 'req-1', {
      decision: 'APPROVE',
    });
    expect(ledger.move).toHaveBeenCalledWith(tx, 'enc-res-1', {
      date: '2099-05-12',
      slotWindow: 'AFTERNOON',
    });

    // Trường hợp move ném SLOT_TAKEN → updateEncounter không được gọi
    session.updateEncounter.mockClear();
    (ledger.move as jest.Mock).mockRejectedValueOnce(
      new ConflictException({ code: 'SLOT_TAKEN', date: '2099-05-12', slotWindow: 'AFTERNOON' }),
    );
    const err = await service
      .decideRescheduleRequest(doctorActor, 'enc-res-1', 'req-1', {
        decision: 'APPROVE',
      })
      .then(() => null, (e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getResponse()).toMatchObject({ code: 'SLOT_TAKEN' });
    expect(session.updateEncounter).not.toHaveBeenCalled();
  });

  it('(d) requestReschedule tới ca đang bị chiếm bởi hợp đồng khác → SLOT_TAKEN', async () => {
    const ledger = createLedgerMock();
    (ledger.listOccupied as jest.Mock).mockResolvedValueOnce([
      {
        date: '2099-05-15',
        slotWindow: 'MORNING',
        contractId: 'other-contract',
        status: 'BOOKED',
      },
    ]);

    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      encounterRescheduleRequest: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      encounter: { findMany: jest.fn().mockResolvedValue([]) },
      medicalContract: { findUnique: jest.fn().mockResolvedValue({ familyId: 'fam-1' }) },
    };
    const session = {
      tx,
      findEncounter: jest.fn().mockResolvedValue({
        id: 'enc-2',
        doctorId: 'doc-1',
        contractId: 'con-1',
        encounterStatus: EncounterStatus.CONFIRMED,
        encounterType: EncounterType.HOME_VISIT,
        category: EncounterCategory.PERIODIC_ROUTINE,
        scheduledDate: new Date('2099-05-10T00:00:00.000Z'),
        scheduledTime: new Date('1970-01-01T08:00:00.000Z'),
        contract: {
          facilityId: 'fac-1',
          startDate: new Date('2099-01-01T00:00:00.000Z'),
          endDate: new Date('2099-12-31T00:00:00.000Z'),
          familyUnit: { representativeUserId: 'user-fam-1' },
          facility: { user: { id: 'user-fac-1' } },
        },
        doctor: { user: { id: 'user-doc-1' } },
      }),
      findPendingRescheduleRequestByEncounter: jest.fn().mockResolvedValue(null),
      createRescheduleRequest: jest.fn(),
    };

    const service = createServiceWithMockSession(session, ledger);
    const err = await service
      .requestReschedule(familyActor, 'enc-2', {
        proposedDate: '2099-05-15',
        proposedTime: '08:00:00',
        rescheduleReason: 'Bận đột xuất',
      })
      .then(() => null, (e) => e);

    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getResponse()).toMatchObject({ code: 'SLOT_TAKEN' });
    expect(session.createRescheduleRequest).not.toHaveBeenCalled();
  });

  it('(e) cancelEncounter → gọi releaseEncounter', async () => {
    const ledger = createLedgerMock();
    const tx = {};
    const session = {
      tx,
      findEncounter: jest.fn().mockResolvedValue({
        id: 'enc-cancel-1',
        doctorId: 'doc-1',
        contractId: 'con-1',
        encounterType: EncounterType.HOME_VISIT,
        encounterStatus: EncounterStatus.CONFIRMED,
        scheduledDate: new Date('2099-05-10T00:00:00.000Z'),
        scheduledTime: new Date('1970-01-01T08:00:00.000Z'),
        cancelReason: null,
        contract: { familyUnit: { representativeUserId: 'user-fam-1' } },
      }),
      updateEncounter: jest.fn().mockResolvedValue({
        id: 'enc-cancel-1',
        encounterStatus: EncounterStatus.CANCELLED,
        cancelReason: 'Hủy',
      }),
      createAuditLog: jest.fn(),
    };

    const service = createServiceWithMockSession(session, ledger);
    await service.cancelEncounter(familyActor, 'enc-cancel-1', 'Hủy');

    expect(ledger.releaseEncounter).toHaveBeenCalledWith(tx, 'enc-cancel-1');
  });

  it('(f) handleAutoClose48h đóng encounter → gọi releaseEncounter', async () => {
    const ledger = createLedgerMock();
    const now = new Date('2026-12-05T10:00:00.000Z');
    const prisma = {
      encounter: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([]) // runReminders upcomingEncounters
          .mockResolvedValueOnce([
            {
              id: 'enc-auto-close-1',
              encounterStatus: 'CONFIRMED',
              scheduledDate: new Date('2026-12-01T00:00:00.000Z'),
              scheduledTime: new Date('1970-01-01T08:00:00.000Z'),
              slotWindow: 'MORNING',
              familyConfirmedArrivalAt: null,
              doctorCompletedAt: new Date('2026-12-01T10:00:00.000Z'),
              reminder21hSentAt: new Date('2026-12-01T14:00:00.000Z'),
              recordOverdueAt: null,
              overdueEscalatedAt: null,
              doctor: { user: { id: 'u-doc' }, facility: { userId: 'u-fac' } },
              contract: { familyUnit: { representativeUserId: 'u-fam' } },
              clinicalEmrs: [],
            },
          ]),
        update: jest.fn().mockResolvedValue({}),
      },
      notification: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
      user: { findMany: jest.fn().mockResolvedValue([]) },
    };

    const reminders = new EncounterRemindersService(prisma as any, ledger);
    await reminders.runReminders(now);

    expect(prisma.encounter.update).toHaveBeenCalledWith({
      where: { id: 'enc-auto-close-1' },
      data: expect.objectContaining({ encounterStatus: 'COMPLETED' }),
    });
    expect(ledger.releaseEncounter).toHaveBeenCalledWith(prisma, 'enc-auto-close-1');
  });

  it('(g) bác sĩ từ chối lịch video REQUESTED → encounter CANCELLED và releaseEncounter', async () => {
    const ledger = createLedgerMock();
    const tx = {};
    const doctorActor = { id: 'user-doc-1', role: 'DOCTOR', familyUnitId: null } as AuthenticatedUser;
    const session = {
      tx,
      findEncounter: jest.fn().mockResolvedValue({
        id: 'enc-video-1',
        doctorId: 'doc-1',
        contractId: 'con-1',
        encounterType: EncounterType.TELEHEALTH,
        encounterStatus: EncounterStatus.REQUESTED,
        scheduledDate: new Date('2099-05-10T00:00:00.000Z'),
        scheduledTime: new Date('1970-01-01T09:00:00.000Z'),
        contract: { familyUnit: { representativeUserId: 'user-fam-1' } },
      }),
      findDoctorByUserId: jest.fn().mockResolvedValue({ id: 'doc-1' }),
      releaseTelehealthQuota: jest.fn().mockResolvedValue(undefined),
      updateEncounter: jest.fn().mockResolvedValue({
        id: 'enc-video-1',
        encounterStatus: EncounterStatus.CANCELLED,
      }),
      createAuditLog: jest.fn(),
      createNotification: jest.fn(),
    };

    const service = createServiceWithMockSession(session, ledger);
    await service.confirmEncounter(doctorActor, 'enc-video-1', { confirmed: false } as any);

    expect(ledger.releaseEncounter).toHaveBeenCalledWith(tx, 'enc-video-1');
  });
});
