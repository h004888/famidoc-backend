import { EncountersServiceImpl } from '../services/impl/encounters.service.impl';
import type { SlotLedgerService } from '../../scheduling/slot-ledger.service';
import type { AuthenticatedUser } from '../../../core/auth/authenticated-request';

describe('getDoctorVideoAvailability (2 ca trọn khung từ SlotLedger)', () => {
  const familyActor: AuthenticatedUser = {
    id: 'user-fam-1',
    role: 'FAMILY_REP',
    familyUnitId: null,
  } as AuthenticatedUser;

  it('trả về 2 ca trọn khung (không còn slot con 30 phút) đọc từ 1 lần listOccupied', async () => {
    const vnNow = new Date(Date.now() + 7 * 60 * 60 * 1000);
    const futureDate = new Date(vnNow.getTime() + 5 * 86_400_000);
    // Tránh Chủ nhật
    if (futureDate.getUTCDay() === 0) {
      futureDate.setUTCDate(futureDate.getUTCDate() + 1);
    }
    const targetIso = futureDate.toISOString().slice(0, 10);
    const month = targetIso.slice(0, 7);

    const ledger = {
      listOccupied: jest.fn().mockResolvedValue([
        {
          date: targetIso,
          slotWindow: 'MORNING',
          contractId: 'other-contract',
          status: 'BOOKED',
        },
      ]),
    } as unknown as jest.Mocked<SlotLedgerService>;

    const tx = {
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

    const service = new EncountersServiceImpl(repo as any, ledger);
    const res = await service.getDoctorVideoAvailability(
      familyActor,
      'doc-1',
      month,
      'my-contract',
    );

    expect(ledger.listOccupied).toHaveBeenCalledTimes(1);
    const day = res.days.find((d: any) => d.date === targetIso)!;
    expect(day.morning).toMatchObject({
      available: false,
      reasonCode: 'TAKEN',
      label: 'Đã có lịch',
    });
    expect(day.afternoon).toMatchObject({
      available: true,
      reasonCode: 'AVAILABLE',
      label: 'Còn trống',
    });
    // Không còn danh sách nhiều mốc 30 phút (08:30, 09:00, ...)
    expect((day.afternoon as any).candidateTimes ?? []).not.toContain('14:00');
  });
});
