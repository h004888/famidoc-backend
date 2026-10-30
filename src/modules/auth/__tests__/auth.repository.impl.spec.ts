import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../core/database/prisma.service';
import { AuthRepositoryImpl } from '../repositories/impl/auth.repository.impl';
import { AuthEntity } from '../repositories/interfaces/auth.repository.interface';

describe('AuthRepositoryImpl', () => {
  let repository: AuthRepositoryImpl;
  let prismaService: any;

  beforeEach(async () => {
    prismaService = {
      user: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      familyUnit: {
        create: jest.fn(),
        update: jest.fn(),
      },
      patient: {
        create: jest.fn(),
      },
      auditLog: {
        create: jest.fn(),
      },
      $transaction: jest.fn((cb) => cb(prismaService)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthRepositoryImpl,
        {
          provide: PrismaService,
          useValue: prismaService,
        },
      ],
    }).compile();

    repository = module.get<AuthRepositoryImpl>(AuthRepositoryImpl);
  });

  it('được khởi tạo thành công', () => {
    expect(repository).toBeDefined();
  });

  it('[UT-R-01] findByEmail gọi prisma.user.findUnique với where.email', async () => {
    const user = { id: '1', email: 'test@famidoc.vn' };
    prismaService.user.findUnique.mockResolvedValue(user);

    const result = await repository.findByEmail('test@famidoc.vn');
    expect(prismaService.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'test@famidoc.vn' },
    });
    expect(result).toEqual(user);
  });

  it('[UT-R-02] findByPhone gọi prisma.user.findFirst với where.phone', async () => {
    const user = { id: '1', phone: '0912345678' };
    prismaService.user.findFirst.mockResolvedValue(user);

    const result = await repository.findByPhone('0912345678');
    expect(prismaService.user.findFirst).toHaveBeenCalledWith({
      where: { phone: '0912345678' },
    });
    expect(result).toEqual(user);
  });

  it('[UT-R-03] createFamilyRepWithProfile thực hiện transaction tạo User, FamilyUnit, Patient', async () => {
    const mockUser = { id: 'u-1', email: 'rep@famidoc.vn', role: 'FAMILY_REP' };
    const mockFamily = { id: 'f-1', representativeUserId: 'u-1' };
    const mockPatient = { id: 'p-1', familyId: 'f-1' };

    prismaService.user.create.mockResolvedValue(mockUser);
    prismaService.familyUnit.create.mockResolvedValue(mockFamily);
    prismaService.patient.create.mockResolvedValue(mockPatient);
    prismaService.auditLog.create.mockResolvedValue({ id: 'a-1' });

    const result = await repository.createFamilyRepWithProfile({
      email: 'rep@famidoc.vn',
      phone: '0912345678',
      passwordHash: 'hash123',
      fullName: 'Nguyen Van A',
      homeAddress: '123 Đường Y Tế',
    });

    expect(prismaService.$transaction).toHaveBeenCalled();
    expect(prismaService.user.create).toHaveBeenCalledWith({
      data: {
        email: 'rep@famidoc.vn',
        phone: '0912345678',
        passwordHash: 'hash123',
        fullName: 'Nguyen Van A',
        role: 'FAMILY_REP',
        status: 'ACTIVE',
      },
    });
    expect(prismaService.familyUnit.create).toHaveBeenCalledWith({
      data: {
        representativeUserId: 'u-1',
        homeAddress: '123 Đường Y Tế',
        emergencyPhone: '0912345678',
        status: 'ACTIVE',
      },
    });
    expect(prismaService.patient.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        familyId: 'f-1',
        fullName: 'Nguyen Van A',
        relationshipToHead: 'SELF',
      }),
    });
    expect(prismaService.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: 'u-1',
        action: 'REGISTER_FAMILY_REP',
        resourceName: 'users',
      }),
    });
    expect(result).toEqual(mockUser);
  });

  it('[UT-R-04] updatePassword cập nhật passwordHash của user', async () => {
    prismaService.user.update.mockResolvedValue({ id: 'u-1', passwordHash: 'new_hash' });

    await repository.updatePassword('u-1', 'new_hash');
    expect(prismaService.user.update).toHaveBeenCalledWith({
      where: { id: 'u-1' },
      data: { passwordHash: 'new_hash' },
    });
  });

  it('[FI-06] createFamilyRepWithProfile rollback khi patient create gặp sự cố', async () => {
    prismaService.familyUnit.create.mockResolvedValue({ id: 'f-1' });
    prismaService.user.create.mockResolvedValue({ id: 'u-1' });
    prismaService.patient.create.mockRejectedValue(new Error('Patient creation failed'));

    await expect(
      repository.createFamilyRepWithProfile({
        email: 'rep@famidoc.vn',
        phone: '0912345678',
        passwordHash: 'hash123',
        fullName: 'Nguyen Van A',
      }),
    ).rejects.toThrow('Patient creation failed');
  });

  it('[UT-R-06] AuthEntity contract matches 29-table DDL without tokenVersion', () => {
    const entity: AuthEntity = {
      id: 'u-1',
      email: 'test@famidoc.vn',
      phone: '0912345678',
      passwordHash: 'hash',
      fullName: 'Test User',
      role: 'FAMILY_REP',
      status: 'ACTIVE',
      failedLoginAttempts: 0,
      lockedUntil: null,
      avatarUrl: null,
    };
    expect(entity.id).toBe('u-1');
  });
});
