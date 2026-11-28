import { Icd10Service } from '../icd10.service';

describe('Icd10Service', () => {
  let service: Icd10Service;
  let prisma: {
    icd10Code: {
      findMany: jest.Mock;
    };
  };

  beforeEach(() => {
    prisma = {
      icd10Code: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    service = new Icd10Service(prisma as any);
  });

  it('searches by code prefix (uppercased) when q starts with letter + digit and defaults limit to 20', async () => {
    await service.search({ q: 'i10' });

    expect(prisma.icd10Code.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          isActive: true,
          code: { startsWith: 'I10' },
        }),
        orderBy: { code: 'asc' },
        take: 20,
        select: {
          code: true,
          nameVi: true,
          nameEn: true,
          chapter: true,
          daggerAsterisk: true,
          allowedAsPrimary: true,
          longTermEligible: true,
        },
      }),
    );
  });

  it('searches by nameVi contains insensitive and filters allowedAsPrimary when primaryOnly is true', async () => {
    await service.search({ q: 'tăng huyết', primaryOnly: true });

    expect(prisma.icd10Code.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          isActive: true,
          allowedAsPrimary: true,
          nameVi: { contains: 'tăng huyết', mode: 'insensitive' },
        }),
        orderBy: { code: 'asc' },
        take: 20,
      }),
    );
  });

  it('caps limit at 50 when limit is greater than 50', async () => {
    await service.search({ q: 'i10', limit: 500 });

    expect(prisma.icd10Code.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 50,
      }),
    );
  });

  it('finds active ICD-10 codes by normalized code list', async () => {
    await service.findActiveByCodes(['i10', ' E11.9 ']);

    expect(prisma.icd10Code.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          code: { in: ['I10', 'E11.9'] },
          isActive: true,
        },
      }),
    );
  });

  it('returns empty array without querying when findActiveByCodes receives empty input', async () => {
    const result = await service.findActiveByCodes([]);

    expect(result).toEqual([]);
    expect(prisma.icd10Code.findMany).not.toHaveBeenCalled();
  });
});
