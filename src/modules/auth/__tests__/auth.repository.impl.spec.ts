import { AuthRepositoryImpl } from '../repositories/impl/auth.repository.impl';

describe('AuthRepositoryImpl - auth_sessions', () => {
  let repo: AuthRepositoryImpl;
  let prisma: any;
  let tx: any;

  beforeEach(() => {
    tx = {
      authSession: {
        updateMany: jest.fn(),
        create: jest.fn(),
      },
    };
    prisma = {
      user: {},
      authSession: {
        create: jest.fn(),
        findUnique: jest.fn(),
        updateMany: jest.fn(),
        deleteMany: jest.fn(),
      },
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    };
    repo = new AuthRepositoryImpl(prisma);
  });

  it('createAuthSession persists hashed refresh token session', async () => {
    const expiresAt = new Date(Date.now() + 3600_000);
    const created = {
      id: 'sess-1',
      userId: 'user-1',
      tokenHash: 'hash-1',
      familyId: 'fam-1',
      rememberMe: false,
      clientIp: '127.0.0.1',
      userAgent: 'jest',
      expiresAt,
      revokedAt: null,
      replacedBySessionId: null,
      createdAt: new Date(),
    };
    prisma.authSession.create.mockResolvedValue(created);

    const res = await (repo as any).createAuthSession({
      userId: 'user-1',
      tokenHash: 'hash-1',
      familyId: 'fam-1',
      rememberMe: false,
      clientIp: '127.0.0.1',
      userAgent: 'jest',
      expiresAt,
    });

    expect(prisma.authSession.create).toHaveBeenCalledTimes(1);
    expect(res.id).toBe('sess-1');
  });

  it('rotateAuthSession atomically revokes old session and creates replacement in same family', async () => {
    const expiresAt = new Date(Date.now() + 3600_000);
    const nextSession = {
      id: 'sess-2',
      userId: 'user-1',
      tokenHash: 'hash-2',
      familyId: 'fam-1',
      rememberMe: false,
      expiresAt,
      revokedAt: null,
      replacedBySessionId: null,
      createdAt: new Date(),
    };
    tx.authSession.create.mockResolvedValue(nextSession);
    tx.authSession.updateMany.mockResolvedValue({ count: 1 });

    const res = await (repo as any).rotateAuthSession({
      currentSessionId: 'sess-1',
      familyId: 'fam-1',
      newSession: {
        userId: 'user-1',
        tokenHash: 'hash-2',
        familyId: 'fam-1',
        rememberMe: false,
        expiresAt,
      },
    });

    expect(res.rotated).toBe(true);
    expect(res.session?.id).toBe('sess-2');
    expect(tx.authSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'sess-1', revokedAt: null }),
        data: expect.objectContaining({ replacedBySessionId: 'sess-2' }),
      }),
    );
  });

  it('rotateAuthSession revokes entire familyId on reuse detection (count = 0)', async () => {
    tx.authSession.create.mockResolvedValue({ id: 'sess-2' });
    tx.authSession.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 2 });

    const res = await (repo as any).rotateAuthSession({
      currentSessionId: 'sess-1',
      familyId: 'fam-1',
      newSession: {
        userId: 'user-1',
        tokenHash: 'hash-2',
        familyId: 'fam-1',
        rememberMe: false,
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });

    expect(res).toEqual({ rotated: false, session: null });
    expect(tx.authSession.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { familyId: 'fam-1', revokedAt: null },
      }),
    );
  });

  it('revokeAuthSessionByTokenHash and revokeAllUserAuthSessions mark sessions revoked', async () => {
    prisma.authSession.updateMany.mockResolvedValue({ count: 1 });
    await (repo as any).revokeAuthSessionByTokenHash('hash-1');
    await (repo as any).revokeAllUserAuthSessions('user-1');
    expect(prisma.authSession.updateMany).toHaveBeenCalledTimes(2);
  });

  it('createFamilyRepEntities creates SELF patient with null dateOfBirth and gender', async () => {
    const txMock = {
      user: { create: jest.fn().mockResolvedValue({ id: 'user-1' }) },
      familyUnit: { create: jest.fn().mockResolvedValue({ id: 'fam-1' }) },
      patient: { create: jest.fn().mockResolvedValue({ id: 'pat-1' }) },
      auditLog: { create: jest.fn().mockResolvedValue({ id: 'log-1' }) },
    };

    await (repo as any).createFamilyRepEntities(txMock, {
      email: 'rep@example.com',
      phone: '0901234567',
      passwordHash: 'hash',
      fullName: 'Nguyễn Văn A',
      homeAddress: '123 Đường A',
    });

    expect(txMock.patient.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        relationshipToHead: 'SELF',
        dateOfBirth: null,
        gender: null,
      }),
    });
  });
});
