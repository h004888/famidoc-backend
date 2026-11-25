import type { Prisma } from '@prisma/client';
import { PrismaContractsSession } from '../repositories/impl/contracts.repository.impl';
import type { IContractsRepository } from '../repositories/interfaces/contracts.repository.interface';
import { ContractsServiceImpl } from '../services/impl/contracts.service.impl';

describe('Family Gate Status (hasHistoricalContracts)', () => {
  const familyActor = {
    id: 'user-rep-1',
    role: 'FAMILY_REP' as const,
    familyUnitId: 'fam-1',
  };

  it('returns hasHistoricalContracts=false when familyId is missing', async () => {
    const repository = {
      transaction: async (work: (session: any) => Promise<any>) =>
        work({
          findFamilyByRepresentativeUserId: jest.fn().mockResolvedValue(null),
          findFamilyGateStatus: jest.fn(),
        }),
    } as unknown as IContractsRepository;

    const service = new ContractsServiceImpl(repository);
    const result = await service.getFamilyGateStatus({
      id: 'user-rep-new',
      role: 'FAMILY_REP',
      familyUnitId: null,
    });

    expect(result).toMatchObject({
      hasActiveContract: false,
      hasHistoricalContracts: false,
      activeContract: null,
      pendingContract: null,
    });
  });

  it('returns hasHistoricalContracts=true from PrismaContractsSession when EXPIRED/TERMINATED contracts exist', async () => {
    const tx = {
      medicalContract: {
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(1),
      },
      familyUnit: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'fam-1',
          homeAddress: '123 Lê Lợi',
          emergencyPhone: '0901234567',
          representativeUser: { fullName: 'Nguyễn Văn An' },
        }),
      },
      patient: {
        count: jest.fn().mockResolvedValue(2),
      },
    } as unknown as Prisma.TransactionClient;

    const session = new PrismaContractsSession(tx);
    const gate = await session.findFamilyGateStatus('fam-1');
    expect(gate.hasHistoricalContracts).toBe(true);

    const repository = {
      transaction: async (work: (s: any) => Promise<any>) => work(session),
    } as unknown as IContractsRepository;
    const service = new ContractsServiceImpl(repository);
    const result = await service.getFamilyGateStatus(familyActor);

    expect(result).toMatchObject({
      hasActiveContract: false,
      hasHistoricalContracts: true,
    });
  });

  it('returns hasHistoricalContracts=false when family has never had any historical contracts', async () => {
    const tx = {
      medicalContract: {
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
      },
      familyUnit: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'fam-1',
          homeAddress: '123 Lê Lợi',
          emergencyPhone: '0901234567',
          representativeUser: { fullName: 'Nguyễn Văn An' },
        }),
      },
      patient: {
        count: jest.fn().mockResolvedValue(0),
      },
    } as unknown as Prisma.TransactionClient;

    const session = new PrismaContractsSession(tx);
    const repository = {
      transaction: async (work: (s: any) => Promise<any>) => work(session),
    } as unknown as IContractsRepository;
    const service = new ContractsServiceImpl(repository);
    const result = await service.getFamilyGateStatus(familyActor);

    expect(result).toMatchObject({
      hasActiveContract: false,
      hasHistoricalContracts: false,
    });
  });

  it('preserves activeContract fields and returns hasHistoricalContracts when ACTIVE contract exists', async () => {
    const tx = {
      medicalContract: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({
            id: 'ctr-active-1',
            contractNumber: 'HD-2026-0042',
            memberCount: 4,
            endDate: new Date('2027-01-31T00:00:00.000Z'),
            servicePackage: {
              packageName: 'Gói Đồng Hành Gia Đình',
              description: 'Mô tả gói',
            },
            facility: { facilityName: 'BV Chợ Rẫy', hotline: '02838554137' },
            doctor: null,
          })
          .mockResolvedValueOnce(null),
        count: jest.fn().mockResolvedValue(0),
      },
      familyUnit: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'fam-1',
          homeAddress: '123 Lê Lợi',
          emergencyPhone: '0901234567',
          representativeUser: { fullName: 'Nguyễn Văn An' },
        }),
      },
      patient: {
        count: jest.fn().mockResolvedValue(4),
      },
    } as unknown as Prisma.TransactionClient;

    const session = new PrismaContractsSession(tx);
    const repository = {
      transaction: async (work: (s: any) => Promise<any>) => work(session),
    } as unknown as IContractsRepository;
    const service = new ContractsServiceImpl(repository);
    const result = await service.getFamilyGateStatus(familyActor);

    expect(result).toMatchObject({
      hasActiveContract: true,
      hasHistoricalContracts: false,
      activeContract: {
        id: 'ctr-active-1',
        contractNumber: 'HD-2026-0042',
        memberCount: 4,
        packageName: 'Gói Đồng Hành Gia Đình',
      },
    });
  });
});
