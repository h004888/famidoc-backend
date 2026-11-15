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
      otpChallenge: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
        update: jest.fn(),
        deleteMany: jest.fn(),
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

  it('[UT-R-07] updateFailedAttempts cập nhật failedLoginAttempts và lockedUntil trên user', async () => {
    const lockDate = new Date(Date.now() + 1800 * 1000);
    prismaService.user.update.mockResolvedValue({ id: 'u-1', failedLoginAttempts: 5, lockedUntil: lockDate });

    await repository.updateFailedAttempts('u-1', 5, lockDate);
    expect(prismaService.user.update).toHaveBeenCalledWith({
      where: { id: 'u-1' },
      data: { failedLoginAttempts: 5, lockedUntil: lockDate },
    });
  });

  it('[UT-R-08] resetFailedAttempts đặt lại failedLoginAttempts về 0 và lockedUntil về null', async () => {
    prismaService.user.update.mockResolvedValue({ id: 'u-1', failedLoginAttempts: 0, lockedUntil: null });

    await repository.resetFailedAttempts('u-1');
    expect(prismaService.user.update).toHaveBeenCalledWith({
      where: { id: 'u-1' },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    });
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

  it('[UT-R-09] completeFamilyRepRegistration tạo User/Family/Patient/AuditLog và xóa challenge trong cùng transaction', async () => {
    const mockUser = { id: 'u-2', email: 'rep2@famidoc.vn', role: 'FAMILY_REP' };
    prismaService.user.create.mockResolvedValue(mockUser);
    prismaService.familyUnit.create.mockResolvedValue({ id: 'f-2' });
    prismaService.patient.create.mockResolvedValue({ id: 'p-2' });
    prismaService.auditLog.create.mockResolvedValue({ id: 'a-2' });
    prismaService.otpChallenge.deleteMany.mockResolvedValue({ count: 1 });

    const result = await repository.completeFamilyRepRegistration(
      {
        email: 'rep2@famidoc.vn',
        phone: '0912345679',
        passwordHash: 'hash123',
        fullName: 'Tran Thi B',
      },
      'rep2@famidoc.vn',
    );

    expect(prismaService.$transaction).toHaveBeenCalled();
    expect(prismaService.otpChallenge.deleteMany).toHaveBeenCalledWith({
      where: {
        purpose: 'REGISTER_FAMILY_REP',
        email: 'rep2@famidoc.vn',
      },
    });
    expect(result).toEqual(mockUser);
  });

  it('[UT-R-10] upsertOtpChallenge dọn bản ghi hết hạn cũ và upsert challenge theo (purpose, email)', async () => {
    const expiresAt = new Date(Date.now() + 300_000);
    const cooldownUntil = new Date(Date.now() + 60_000);
    prismaService.otpChallenge.deleteMany.mockResolvedValue({ count: 0 });
    prismaService.otpChallenge.upsert.mockResolvedValue({
      id: 'otp-1',
      purpose: 'REGISTER_FAMILY_REP',
      email: 'new@famidoc.vn',
      otpHash: 'sha256-hex',
      expiresAt,
      cooldownUntil,
      attempts: 0,
      maxAttempts: 5,
    });

    const record = await repository.upsertOtpChallenge({
      purpose: 'REGISTER_FAMILY_REP',
      email: 'new@famidoc.vn',
      phone: '0912345678',
      payload: { fullName: 'Nguyen A', passwordHash: 'bcrypt-hash' },
      otpHash: 'sha256-hex',
      expiresAt,
      cooldownUntil,
    });

    expect(prismaService.otpChallenge.deleteMany).toHaveBeenCalled();
    expect(prismaService.otpChallenge.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          purpose_email: {
            purpose: 'REGISTER_FAMILY_REP',
            email: 'new@famidoc.vn',
          },
        },
      }),
    );
    expect(record.id).toBe('otp-1');
  });

  it('[UT-R-11] incrementOtpChallengeAttempts và deleteOtpChallenge gọi đúng Prisma API', async () => {
    prismaService.otpChallenge.update.mockResolvedValue({ attempts: 3 });
    prismaService.otpChallenge.deleteMany.mockResolvedValue({ count: 1 });

    const attempts = await repository.incrementOtpChallengeAttempts('otp-1');
    expect(attempts).toBe(3);

    await repository.deleteOtpChallenge('REGISTER_FAMILY_REP', 'new@famidoc.vn');
    expect(prismaService.otpChallenge.deleteMany).toHaveBeenCalledWith({
      where: { purpose: 'REGISTER_FAMILY_REP', email: 'new@famidoc.vn' },
    });
  });
});
