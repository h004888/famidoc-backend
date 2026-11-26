import { EncountersServiceImpl } from '../services/impl/encounters.service.impl';
import type { SlotLedgerService } from '../../scheduling/slot-ledger.service';
import type { AuthenticatedUser } from '../../../core/auth/authenticated-request';

describe('Task 8: getDoctorMonthlyAvailability (SlotLedger)', () => {
  const familyActor: AuthenticatedUser = {
    id: 'user-fam-1',
    role: 'FAMILY_REP',
    familyUnitId: null,
  } as AuthenticatedUser;

  function makeService(occupied: Array<{
    date: string;
    slotWindow: 'MORNING' | 'AFTERNOON';
    contractId: string;
    status: 'HELD' | 'BOOKED';
  }>) {
    const ledger = {
      listOccupied: jest.fn().mockResolvedValue(occupied),
    } as unknown as jest.Mocked<SlotLedgerService>;

    const tx = {
      encounterRescheduleRequest: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      medicalContract: {
        findUnique: jest.fn().mockResolvedValue({
          familyId: 'fam-1',
          startDate: new Date('2020-01-01T00:00:00.000Z'),
          endDate: new Date('2099-12-31T00:00:00.000Z'),
        }),
      },
    };
    const repo = {
      transaction: jest.fn(async (cb: (s: any) => Promise<any>) => cb({ tx })),
    };

    return {
      service: new EncountersServiceImpl(repo as any, ledger),
      ledger,
    };
  }

  it('(a)(b)(c)(d)(f) trả reasonCode, label tiếng Việt đúng và không lộ contractId của hợp đồng khác', async () => {
    // Tháng 2099-05: 2099-05-03 là Chủ nhật, 2099-05-04 là Thứ 2, 2099-05-05 là Thứ 3
    const { service, ledger } = makeService([
      {
        date: '2099-05-04',
        slotWindow: 'MORNING',
        contractId: 'other-contract-secret-id',
        status: 'BOOKED',
      },
      {
        date: '2099-05-05',
        slotWindow: 'MORNING',
        contractId: 'my-contract-1',
        status: 'BOOKED',
      },
    ]);

    const res = await service.getDoctorMonthlyAvailability(
      familyActor,
      'doc-1',
      '2099-05',
      'my-contract-1',
    );

    expect(ledger.listOccupied).toHaveBeenCalledTimes(1);

    const may04 = res.days.find((d: any) => d.date === '2099-05-04')!;
    expect(may04.morning).toMatchObject({
      available: false,
      reasonCode: 'TAKEN',
      label: 'Đã có lịch',
    });
    expect(may04.afternoon).toMatchObject({
      available: true,
      reasonCode: 'AVAILABLE',
      label: 'Còn trống',
    });

    const may05 = res.days.find((d: any) => d.date === '2099-05-05')!;
    expect(may05.morning).toMatchObject({
      available: false,
      reasonCode: 'OWN_VISIT',
      label: 'Lịch của bạn',
    });
    expect(may05.afternoon).toMatchObject({
      available: false,
      reasonCode: 'FAMILY_SAME_DAY',
      label: 'Gia đình đã có lượt trong ngày',
    });

    const may03Sunday = res.days.find((d: any) => d.date === '2099-05-03')!;
    expect(may03Sunday.morning).toMatchObject({
      available: false,
      reasonCode: 'DAY_OFF',
      label: 'Ngày nghỉ',
    });
    expect(may03Sunday.afternoon).toMatchObject({
      available: false,
      reasonCode: 'DAY_OFF',
      label: 'Ngày nghỉ',
    });

    // (f) Không lộ contractId của hợp đồng khác
    expect(JSON.stringify(res)).not.toContain('other-contract-secret-id');
  });

  it('(e) ngày hôm nay → reasonCode PAST', async () => {
    const vnNow = new Date(Date.now() + 7 * 60 * 60 * 1000);
    const todayIso = vnNow.toISOString().slice(0, 10);
    const currentMonth = todayIso.slice(0, 7);

    const { service } = makeService([]);
    const res = await service.getDoctorMonthlyAvailability(
      familyActor,
      'doc-1',
      currentMonth,
    );

    const todayDay = res.days.find((d: any) => d.date === todayIso)!;
    expect(todayDay.morning).toMatchObject({
      available: false,
      reasonCode: 'PAST',
      label: 'Đã qua',
    });
    expect(todayDay.afternoon).toMatchObject({
      available: false,
      reasonCode: 'PAST',
      label: 'Đã qua',
    });
  });
});
