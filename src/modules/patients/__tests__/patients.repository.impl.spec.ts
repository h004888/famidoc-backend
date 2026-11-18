import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Gender } from '@prisma/client';
import { PatientsRepositoryImpl } from '../repositories/impl/patients.repository.impl';
import type { CreatePatientDto } from '../dtos/create-patient.dto';

describe('PatientsRepositoryImpl - atomic memberCount lock & metadata', () => {
  const familyId = '11111111-1111-4111-8111-111111111111';
  const dto: CreatePatientDto = {
    fullName: 'Nguyễn Kiểm Thử Con',
    dateOfBirth: '2015-05-20',
    gender: Gender.FEMALE,
    relationshipToHead: 'CHILD',
    bloodType: 'A+',
    chronicDiseases: 'Không',
  };

  it('khóa dòng hợp đồng ACTIVE bằng FOR UPDATE, đếm ACTIVE, tạo Patient và ContractMember trong 1 transaction', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'contract-1', member_count: 2 }]),
      patient: {
        count: jest.fn().mockResolvedValue(1),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'pt-new', fullName: dto.fullName }),
      },
      contractMember: {
        create: jest.fn().mockResolvedValue({ id: 'cm-new' }),
      },
    };
    const prisma = {
      $transaction: jest.fn((cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
    } as any;

    const repo = new PatientsRepositoryImpl(prisma);
    const created = await repo.createWithActiveContractLock(familyId, dto);

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.patient.count).toHaveBeenCalledWith({
      where: { familyId, status: 'ACTIVE' },
    });
    expect(tx.patient.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        familyId,
        relationshipToHead: 'CHILD',
        bloodType: 'A+',
        chronicDiseases: 'Không',
        status: 'ACTIVE',
      }),
    });
    expect(tx.contractMember.create).toHaveBeenCalledWith({
      data: { contractId: 'contract-1', patientId: 'pt-new' },
    });
    expect(created.id).toBe('pt-new');
  });

  it('ném ForbiddenException (403) nếu không có hợp đồng ACTIVE khi khóa dòng', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      patient: { count: jest.fn(), findFirst: jest.fn(), create: jest.fn() },
      contractMember: { create: jest.fn() },
    };
    const prisma = {
      $transaction: jest.fn((cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
    } as any;

    const repo = new PatientsRepositoryImpl(prisma);
    await expect(repo.createWithActiveContractLock(familyId, dto)).rejects.toThrow(
      ForbiddenException,
    );
    expect(tx.patient.create).not.toHaveBeenCalled();
  });

  it('ném BadRequestException (400) nếu số thành viên ACTIVE đạt trần memberCount', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'contract-1', member_count: 2 }]),
      patient: { count: jest.fn().mockResolvedValue(2), findFirst: jest.fn(), create: jest.fn() },
      contractMember: { create: jest.fn() },
    };
    const prisma = {
      $transaction: jest.fn((cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
    } as any;

    const repo = new PatientsRepositoryImpl(prisma);
    await expect(repo.createWithActiveContractLock(familyId, dto)).rejects.toThrow(
      BadRequestException,
    );
    expect(tx.patient.create).not.toHaveBeenCalled();
  });

  it('ném ConflictException (409) khi trùng chủ hộ SELF đang ACTIVE', async () => {
    const txSelf = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'contract-1', member_count: 4 }]),
      patient: {
        count: jest.fn().mockResolvedValue(1),
        findFirst: jest.fn().mockResolvedValueOnce({ id: 'pt-head' }),
        create: jest.fn(),
      },
      contractMember: { create: jest.fn() },
    };
    const repoSelf = new PatientsRepositoryImpl({
      $transaction: jest.fn((cb: (t: typeof txSelf) => Promise<unknown>) => cb(txSelf)),
    } as any);
    await expect(
      repoSelf.createWithActiveContractLock(familyId, { ...dto, relationshipToHead: 'SELF' }),
    ).rejects.toThrow(ConflictException);
    expect(txSelf.patient.create).not.toHaveBeenCalled();
  });
});
