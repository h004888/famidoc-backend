import { ValidationPipe } from '@nestjs/common';
import { AdminOverviewQuery, AdminFinanceReportQuery } from '../admin.dto';

describe('AdminOverviewQuery & AdminFinanceReportQuery Validation', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
  });

  describe('AdminOverviewQuery', () => {
    it('accepts valid query with period and environment', async () => {
      const res = await pipe.transform(
        { period: 'monthly', environment: 'LIVE' },
        { type: 'query', metatype: AdminOverviewQuery },
      );
      expect(res.period).toBe('monthly');
      expect(res.environment).toBe('LIVE');
    });

    it('accepts empty query and uses defaults', async () => {
      const res = await pipe.transform(
        {},
        { type: 'query', metatype: AdminOverviewQuery },
      );
      expect(res.period).toBe('monthly');
      expect(res.environment).toBe('LIVE');
    });

    it('accepts weekly and yearly periods and TEST environment', async () => {
      const res = await pipe.transform(
        { period: 'weekly', environment: 'TEST' },
        { type: 'query', metatype: AdminOverviewQuery },
      );
      expect(res.period).toBe('weekly');
      expect(res.environment).toBe('TEST');
    });

    it('rejects unknown query properties because forbidNonWhitelisted is true', async () => {
      await expect(
        pipe.transform(
          { period: 'monthly', unknownField: 'test' },
          { type: 'query', metatype: AdminOverviewQuery },
        ),
      ).rejects.toThrow();
    });

    it('rejects invalid period', async () => {
      await expect(
        pipe.transform(
          { period: 'daily' },
          { type: 'query', metatype: AdminOverviewQuery },
        ),
      ).rejects.toThrow();
    });

    it('rejects invalid environment', async () => {
      await expect(
        pipe.transform(
          { environment: 'DEV' },
          { type: 'query', metatype: AdminOverviewQuery },
        ),
      ).rejects.toThrow();
    });
  });

  describe('AdminFinanceReportQuery', () => {
    it('accepts year and environment', async () => {
      const res = await pipe.transform(
        { year: '2026', environment: 'LIVE' },
        { type: 'query', metatype: AdminFinanceReportQuery },
      );
      expect(res.year).toBe(2026);
      expect(res.environment).toBe('LIVE');
    });

    it('rejects invalid year', async () => {
      await expect(
        pipe.transform(
          { year: '1990' },
          { type: 'query', metatype: AdminFinanceReportQuery },
        ),
      ).rejects.toThrow();
    });
  });
});
