import { EncounterRemindersService } from '../services/impl/encounter-reminders.service';
import type { PrismaService } from '../../../core/database/prisma.service';
import { EncounterType } from '@prisma/client';

describe('EncounterRemindersService', () => {
  let service: EncounterRemindersService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      encounter: {
        findMany: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      user: {
        findMany: jest.fn().mockResolvedValue([{ id: 'admin-user-1' }]),
      },
      notification: {
        createMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
    };

    service = new EncounterRemindersService(mockPrisma as unknown as PrismaService);
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  it('runs reminder checks and creates 24h & 2h notifications', async () => {
    const now = new Date();

    // 1 encounter happening in exactly 24 hours
    const enc24hDate = new Date(now.getTime() + 24 * 3600_000);
    // 1 encounter happening in exactly 2 hours
    const enc2hDate = new Date(now.getTime() + 2 * 3600_000);
    // 1 encounter happening in 10 days (should be ignored)
    const encFarDate = new Date(now.getTime() + 240 * 3600_000);

    const mockEncounters = [
      {
        id: 'enc-24h',
        scheduledDate: enc24hDate,
        scheduledTime: enc24hDate,
        encounterType: EncounterType.HOME_VISIT,
        contract: {
          familyUnit: { representativeUserId: 'fam-user-1', representativeUser: { fullName: 'Fam 1' } },
        },
        participants: [{ patient: { fullName: 'Patient 24H' } }],
        doctor: {
          user: { id: 'doc-user-1' },
        },
      },
      {
        id: 'enc-2h',
        scheduledDate: enc2hDate,
        scheduledTime: enc2hDate,
        encounterType: EncounterType.TELEHEALTH,
        contract: {
          familyUnit: { representativeUserId: 'fam-user-2', representativeUser: { fullName: 'Fam 2' } },
        },
        participants: [{ patient: { fullName: 'Patient 2H' } }],
        doctor: {
          user: { id: 'doc-user-2' },
        },
      },
      {
        id: 'enc-far',
        scheduledDate: encFarDate,
        scheduledTime: encFarDate,
        encounterType: EncounterType.HOME_VISIT,
        contract: {
          familyUnit: { representativeUserId: 'fam-user-3', representativeUser: { fullName: 'Fam 3' } },
        },
        participants: [{ patient: { fullName: 'Patient Far' } }],
        doctor: {
          user: { id: 'doc-user-3' },
        },
      },
    ];

    mockPrisma.encounter.findMany.mockResolvedValueOnce(mockEncounters);

    const res = await service.runReminders();

    expect(mockPrisma.encounter.findMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ encounterStatus: 'CONFIRMED' }),
      include: expect.any(Object),
    });

    expect(mockPrisma.notification.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          userId: 'fam-user-1',
          type: 'ENCOUNTER_REMINDER_24H',
          referenceId: 'enc-24h',
        }),
        expect.objectContaining({
          userId: 'doc-user-1',
          type: 'ENCOUNTER_REMINDER_24H',
          referenceId: 'enc-24h',
        }),
        expect.objectContaining({
          userId: 'fam-user-2',
          type: 'ENCOUNTER_REMINDER_2H',
          referenceId: 'enc-2h',
        }),
        expect.objectContaining({
          userId: 'doc-user-2',
          type: 'ENCOUNTER_REMINDER_2H',
          referenceId: 'enc-2h',
        }),
      ]),
      skipDuplicates: true,
    });

    expect(res.processed).toBe(4);
  });

  describe('Post-visit reconciliation (4-milestone SLA & Mức 1 overdue)', () => {
    it('Mốc 21:00 cùng ngày: gửi ENCOUNTER_RECORD_DUE_SOON cho bác sĩ và đánh dấu reminder21hSentAt', async () => {
      const now = new Date('2026-11-25T21:10:00+07:00');
      mockPrisma.encounter.findMany
        .mockResolvedValueOnce([]) // upcomingEncounters
        .mockResolvedValueOnce([
          {
            id: 'enc-21h-1',
            encounterType: 'HOME_VISIT',
            encounterStatus: 'PENDING_RECORD',
            scheduledDate: new Date('2026-11-25T00:00:00.000Z'),
            scheduledTime: new Date('1970-01-01T08:30:00.000Z'),
            slotWindow: 'MORNING',
            doctorCompletedAt: null,
            reminder21hSentAt: null,
            recordOverdueAt: null,
            overdueEscalatedAt: null,
            familyConfirmedArrivalAt: new Date('2026-11-25T01:35:00.000Z'),
            doctor: { user: { id: 'doc-user-1' }, facility: { userId: 'fac-user-1' } },
            contract: { familyUnit: { representativeUserId: 'fam-user-1' } },
            clinicalEmrs: [],
          },
        ]);

      await (service as any).runReminders(now);

      expect(mockPrisma.notification.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({
              userId: 'doc-user-1',
              type: 'ENCOUNTER_RECORD_DUE_SOON',
              referenceId: 'enc-21h-1',
            }),
          ]),
        }),
      );
      expect(mockPrisma.encounter.update).toHaveBeenCalledWith({
        where: { id: 'enc-21h-1' },
        data: expect.objectContaining({ reminder21hSentAt: now }),
      });
    });

    it('Mốc 00:00 ngày T+1: cập nhật recordOverdueAt, gửi ENCOUNTER_RECORD_OVERDUE cho bác sĩ và ENCOUNTER_RECORD_OVERDUE_ESCALATION cho CSYT', async () => {
      const now = new Date('2026-11-26T00:05:00+07:00');
      mockPrisma.encounter.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            id: 'enc-overdue-1',
            encounterType: 'HOME_VISIT',
            encounterStatus: 'PENDING_RECORD',
            scheduledDate: new Date('2026-11-25T00:00:00.000Z'),
            scheduledTime: new Date('1970-01-01T08:30:00.000Z'),
            slotWindow: 'MORNING',
            doctorCompletedAt: null,
            reminder21hSentAt: new Date('2026-11-25T21:05:00+07:00'),
            recordOverdueAt: null,
            overdueEscalatedAt: null,
            familyConfirmedArrivalAt: new Date('2026-11-25T01:35:00.000Z'),
            doctor: { user: { id: 'doc-user-1' }, facility: { userId: 'fac-user-1' } },
            contract: { familyUnit: { representativeUserId: 'fam-user-1' } },
            clinicalEmrs: [],
          },
        ]);

      await (service as any).runReminders(now);

      expect(mockPrisma.encounter.update).toHaveBeenCalledWith({
        where: { id: 'enc-overdue-1' },
        data: expect.objectContaining({ recordOverdueAt: now }),
      });
      expect(mockPrisma.notification.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({
              userId: 'doc-user-1',
              type: 'ENCOUNTER_RECORD_OVERDUE',
              referenceId: 'enc-overdue-1',
            }),
            expect.objectContaining({
              userId: 'fac-user-1',
              type: 'ENCOUNTER_RECORD_OVERDUE_ESCALATION',
              referenceId: 'enc-overdue-1',
            }),
          ]),
        }),
      );
    });

    it('Mốc 23:59 ngày T+1: leo thang Admin & CSYT nếu gia đình đã xác nhận, hoặc hỏi Gia đình ENCOUNTER_ATTENDANCE_CHECK nếu chưa xác nhận', async () => {
      const now = new Date('2026-11-27T00:10:00+07:00');
      mockPrisma.encounter.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            id: 'enc-esc-confirmed',
            encounterType: 'HOME_VISIT',
            encounterStatus: 'PENDING_RECORD',
            scheduledDate: new Date('2026-11-25T00:00:00.000Z'),
            scheduledTime: new Date('1970-01-01T08:30:00.000Z'),
            slotWindow: 'MORNING',
            doctorCompletedAt: null,
            reminder21hSentAt: new Date('2026-11-25T21:05:00+07:00'),
            recordOverdueAt: new Date('2026-11-26T00:05:00+07:00'),
            overdueEscalatedAt: null,
            familyConfirmedArrivalAt: new Date('2026-11-25T01:35:00.000Z'),
            doctor: { user: { id: 'doc-user-1' }, facility: { userId: 'fac-user-1' } },
            contract: { familyUnit: { representativeUserId: 'fam-user-1' } },
            clinicalEmrs: [],
          },
          {
            id: 'enc-esc-unconfirmed',
            encounterType: 'HOME_VISIT',
            encounterStatus: 'CONFIRMED',
            scheduledDate: new Date('2026-11-25T00:00:00.000Z'),
            scheduledTime: new Date('1970-01-01T08:30:00.000Z'),
            slotWindow: 'MORNING',
            doctorCompletedAt: null,
            reminder21hSentAt: new Date('2026-11-25T21:05:00+07:00'),
            recordOverdueAt: new Date('2026-11-26T00:05:00+07:00'),
            overdueEscalatedAt: null,
            familyConfirmedArrivalAt: null,
            doctor: { user: { id: 'doc-user-1' }, facility: { userId: 'fac-user-1' } },
            contract: { familyUnit: { representativeUserId: 'fam-user-2' } },
            clinicalEmrs: [],
          },
        ]);

      await (service as any).runReminders(now);

      expect(mockPrisma.notification.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({
              userId: 'fac-user-1',
              type: 'ENCOUNTER_RECORD_OVERDUE_ESCALATION',
              referenceId: 'enc-esc-confirmed',
            }),
            expect.objectContaining({
              userId: 'admin-user-1',
              type: 'ENCOUNTER_RECORD_OVERDUE_ESCALATION',
              referenceId: 'enc-esc-confirmed',
            }),
            expect.objectContaining({
              userId: 'fam-user-2',
              type: 'ENCOUNTER_ATTENDANCE_CHECK',
              referenceId: 'enc-esc-unconfirmed',
            }),
          ]),
        }),
      );
      expect(mockPrisma.encounter.update).toHaveBeenCalledWith({
        where: { id: 'enc-esc-confirmed' },
        data: expect.objectContaining({ overdueEscalatedAt: now }),
      });
      expect(mockPrisma.encounter.update).toHaveBeenCalledWith({
        where: { id: 'enc-esc-unconfirmed' },
        data: expect.objectContaining({ overdueEscalatedAt: now }),
      });
    });

    it('Mốc 48h sau hết khung ca: tự động chuyển CONFIRMED -> COMPLETED CHỈ KHI doctorCompletedAt != null; KHÔNG tự đóng nếu doctorCompletedAt == null', async () => {
      const now = new Date('2026-11-27T11:35:00+07:00');
      mockPrisma.encounter.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            id: 'enc-auto-complete-1',
            encounterType: 'HOME_VISIT',
            encounterStatus: 'CONFIRMED',
            scheduledDate: new Date('2026-11-25T00:00:00.000Z'),
            scheduledTime: new Date('1970-01-01T08:30:00.000Z'),
            slotWindow: 'MORNING',
            doctorCompletedAt: new Date('2026-11-25T11:20:00+07:00'),
            familyConfirmedArrivalAt: null,
            doctor: { user: { id: 'doc-user-1' }, facility: { userId: 'fac-user-1' } },
            contract: { familyUnit: { representativeUserId: 'fam-user-1' } },
            clinicalEmrs: [{ id: 'emr-1', isFinalized: true }],
          },
          {
            id: 'enc-not-completed-by-doctor',
            encounterType: 'HOME_VISIT',
            encounterStatus: 'CONFIRMED',
            scheduledDate: new Date('2026-11-25T00:00:00.000Z'),
            scheduledTime: new Date('1970-01-01T08:30:00.000Z'),
            slotWindow: 'MORNING',
            doctorCompletedAt: null,
            reminder21hSentAt: new Date('2026-11-25T21:05:00+07:00'),
            recordOverdueAt: new Date('2026-11-26T00:05:00+07:00'),
            overdueEscalatedAt: new Date('2026-11-27T00:05:00+07:00'),
            familyConfirmedArrivalAt: null,
            doctor: { user: { id: 'doc-user-1' }, facility: { userId: 'fac-user-1' } },
            contract: { familyUnit: { representativeUserId: 'fam-user-2' } },
            clinicalEmrs: [{ id: 'emr-2', isFinalized: true }],
          },
        ]);

      await (service as any).runReminders(now);

      expect(mockPrisma.encounter.update).toHaveBeenCalledWith({
        where: { id: 'enc-auto-complete-1' },
        data: { encounterStatus: 'COMPLETED' },
      });
      expect(mockPrisma.encounter.update).not.toHaveBeenCalledWith({
        where: { id: 'enc-not-completed-by-doctor' },
        data: { encounterStatus: 'COMPLETED' },
      });
    });

    it('KHÔNG tự chuyển DISPUTED hoặc NO_SHOW quá 48h sang COMPLETED', async () => {
      const now = new Date('2026-11-27T11:35:00+07:00');
      mockPrisma.encounter.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            id: 'enc-disputed-1',
            encounterType: 'HOME_VISIT',
            encounterStatus: 'DISPUTED',
            scheduledDate: new Date('2026-11-25T00:00:00.000Z'),
            scheduledTime: new Date('1970-01-01T08:30:00.000Z'),
            slotWindow: 'MORNING',
            doctorCompletedAt: new Date('2026-11-25T11:20:00+07:00'),
            familyConfirmedArrivalAt: null,
            doctor: { user: { id: 'doc-user-1' } },
            clinicalEmrs: [{ id: 'emr-1', isFinalized: true }],
          },
          {
            id: 'enc-noshow-1',
            encounterType: 'HOME_VISIT',
            encounterStatus: 'NO_SHOW',
            scheduledDate: new Date('2026-11-25T00:00:00.000Z'),
            scheduledTime: new Date('1970-01-01T08:30:00.000Z'),
            slotWindow: 'MORNING',
            doctorCompletedAt: new Date('2026-11-25T11:20:00+07:00'),
            familyConfirmedArrivalAt: null,
            doctor: { user: { id: 'doc-user-2' } },
            clinicalEmrs: [{ id: 'emr-2', isFinalized: true }],
          },
        ]);

      await (service as any).runReminders(now);

      expect(mockPrisma.encounter.update).not.toHaveBeenCalled();
    });
  });
});
