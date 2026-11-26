import { NotFoundException } from '@nestjs/common';
import { MedicalBooksService } from '../services/medical-books.service';

describe('MedicalBooksService.patientVisits (characterization)', () => {
  const familyActor = { id: 'rep-1', role: 'FAMILY_REP' } as any;

  function makeService() {
    const prisma = {
      patient: { findFirst: jest.fn() },
      encounter: { findMany: jest.fn() },
    };
    const service = new MedicalBooksService(prisma as any, {} as any);
    return { service, prisma };
  }

  it('queries patient encounters with pagination, orderBy, and patient filter', async () => {
    const { service, prisma } = makeService();
    prisma.patient.findFirst.mockResolvedValue({ id: 'pat-1' });
    prisma.encounter.findMany.mockResolvedValue([]);

    await service.patientVisits(familyActor, 'fam-1', 'pat-1', 2);

    const call = prisma.encounter.findMany.mock.calls[0][0];
    expect(call.where.AND[1]).toEqual({
      contract: { familyId: 'fam-1' },
      OR: [
        { participants: { some: { patientId: 'pat-1' } } },
        { clinicalEmrs: { some: { patientId: 'pat-1' } } },
      ],
    });
    expect(call.skip).toBe(12);
    expect(call.take).toBe(13);
    expect(call.orderBy).toEqual([
      { scheduledDate: 'desc' },
      { scheduledTime: 'desc' },
      { id: 'desc' },
    ]);
  });

  it('slices to 12 items and sets hasNextPage when 13 rows returned', async () => {
    const { service, prisma } = makeService();
    prisma.patient.findFirst.mockResolvedValue({ id: 'pat-1' });
    prisma.encounter.findMany.mockResolvedValue(
      Array.from({ length: 13 }, (_, idx) => ({
        id: `enc-${idx}`,
        encounterType: 'HOME_VISIT',
        scheduledDate: new Date('2026-11-20T00:00:00.000Z'),
        scheduledTime: new Date('1970-01-01T08:00:00.000Z'),
        doctor: { doctorName: 'BS. An' },
        clinicalEmrs: [{ isFinalized: true, icd10Diagnosis: 'Sốt' }],
      })),
    );

    const result = await service.patientVisits(familyActor, 'fam-1', 'pat-1', 1);

    expect(result.hasNextPage).toBe(true);
    expect(result.items).toHaveLength(12);
  });

  it('throws NotFoundException when patient is not found and skips encounter query', async () => {
    const { service, prisma } = makeService();
    prisma.patient.findFirst.mockResolvedValue(null);

    await expect(
      service.patientVisits(familyActor, 'fam-1', 'pat-1', 1),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.encounter.findMany).not.toHaveBeenCalled();
  });
});
