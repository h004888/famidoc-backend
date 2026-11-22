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
});
