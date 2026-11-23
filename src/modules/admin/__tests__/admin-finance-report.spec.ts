import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../../core/database/prisma.service';
import type { IAuthService } from '../../auth/services/interfaces/auth.service.interface';
import { AdminService } from '../admin.service';

describe('Admin finance report', () => {
  const queryRaw = jest.fn();
  const service = new AdminService(
    { $queryRaw: queryRaw } as unknown as PrismaService,
    {} as IAuthService,
  );

  afterEach(() => {
    jest.useRealTimers();
    queryRaw.mockReset();
  });

  it('uses one annual household count and returns twelve ordered months of cash movements', async () => {
    queryRaw.mockResolvedValue([
      { month: 2, receivedVnd: new Prisma.Decimal(200_000), paidVnd: new Prisma.Decimal(240_000), purchasingFamilies: 1 },
      { month: null, receivedVnd: new Prisma.Decimal(700_000), paidVnd: new Prisma.Decimal(240_000), purchasingFamilies: 2 },
      { month: 1, receivedVnd: new Prisma.Decimal(500_000), paidVnd: new Prisma.Decimal(0), purchasingFamilies: 2 },
    ]);

    const report = await service.financeReport({ year: 2025, environment: 'LIVE' });

    expect(report.totals).toEqual({ purchasingFamilies: 2, receivedVnd: 700_000, paidVnd: 240_000, netVnd: 460_000 });
    expect(report.months.map(({ month }) => month)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(report.months.slice(0, 3)).toEqual([
      { month: 1, receivedVnd: 500_000, paidVnd: 0 },
      { month: 2, receivedVnd: 200_000, paidVnd: 240_000 },
      { month: 3, receivedVnd: 0, paidVnd: 0 },
    ]);
    const sql = queryRaw.mock.calls[0][0].join(' ');
    expect(sql).toContain('COUNT(DISTINCT purchasing_family_id)');
    expect(sql).toContain('invoice.addendum_id IS NULL AND invoice.encounter_id IS NULL');
    expect(sql).toContain("disbursement_status = 'SETTLED'");
  });

  it('defaults to the year in Vietnam and uses the same environment and date bounds for both amounts', async () => {
    const now = new Date('2025-12-31T17:02:00Z');
    jest.useFakeTimers().setSystemTime(now);
    queryRaw.mockResolvedValue([]);

    const report = await service.financeReport({ environment: 'TEST' });

    expect(report.year).toBe(2026);
    expect(report.totals).toEqual({ purchasingFamilies: 0, receivedVnd: 0, paidVnd: 0, netVnd: 0 });
    const start = new Date('2025-12-31T17:00:00Z');
    const end = new Date('2026-12-31T17:00:00Z');
    expect(queryRaw).toHaveBeenCalledWith(expect.any(Array), 'TEST', start, end, now, 'TEST', start, end, now);
  });
});
