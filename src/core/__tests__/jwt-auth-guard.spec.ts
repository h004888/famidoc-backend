import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ALLOW_ONBOARDING_KEY } from '../auth/allow-onboarding.decorator';

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let jwtService: jest.Mocked<JwtService>;
  let prismaService: any;
  let redisClient: any;
  let reflector: jest.Mocked<Reflector>;

  beforeEach(() => {
    jwtService = {
      verifyAsync: jest.fn(),
      decode: jest.fn(),
    } as any;

    prismaService = {
      user: {
        findUnique: jest.fn(),
      },
    };

    redisClient = {
      mget: jest.fn().mockResolvedValue([null, null]),
    };

    reflector = {
      getAllAndOverride: jest.fn(),
    } as any;

    guard = new JwtAuthGuard(jwtService, prismaService, redisClient, reflector);
  });

  const createMockContext = (authHeader?: string, handler = () => {}, targetClass = {}) => {
    const req: any = {
      headers: {
        authorization: authHeader,
      },
    };

    return {
      switchToHttp: () => ({
        getRequest: () => req,
      }),
      getHandler: () => handler,
      getClass: () => targetClass,
    } as unknown as ExecutionContext;
  };

  it('should throw UnauthorizedException if authorization header is missing', async () => {
    const ctx = createMockContext();
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('should throw UnauthorizedException if token is blacklisted in Redis', async () => {
    const ctx = createMockContext('Bearer token123');
    jwtService.verifyAsync.mockResolvedValue({
      sub: 'user-1',
      iat: 1000,
      exp: 2000,
      jti: 'jti-1',
    });
    redisClient.mget.mockResolvedValue(['revoked', null]);

    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('should allow active user with valid token', async () => {
    const ctx = createMockContext('Bearer token123');
    jwtService.verifyAsync.mockResolvedValue({
      sub: 'user-1',
      iat: 1000,
      exp: 2000,
      jti: 'jti-1',
    });
    redisClient.mget.mockResolvedValue([null, null]);
    prismaService.user.findUnique.mockResolvedValue({
      id: 'user-1',
      role: 'ADMIN',
      status: 'ACTIVE',
      familyUnit: null,
    });

    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
    const req = ctx.switchToHttp().getRequest() as any;
    expect(req.user).toEqual({
      id: 'user-1',
      role: 'ADMIN',
      familyUnitId: null,
    });
  });

  it('should block ONBOARDING_ONLY token on standard routes with 403 Forbidden', async () => {
    const ctx = createMockContext('Bearer token123');
    jwtService.verifyAsync.mockResolvedValue({
      sub: 'doc-user-1',
      iat: 1000,
      exp: 2000,
      scope: 'ONBOARDING_ONLY',
    });
    redisClient.mget.mockResolvedValue([null, null]);
    prismaService.user.findUnique.mockResolvedValue({
      id: 'doc-user-1',
      role: 'DOCTOR',
      status: 'PENDING',
      familyUnit: null,
    });
    reflector.getAllAndOverride.mockReturnValue(false);

    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('should allow ONBOARDING_ONLY doctor on routes with @AllowOnboarding()', async () => {
    const ctx = createMockContext('Bearer token123');
    jwtService.verifyAsync.mockResolvedValue({
      sub: 'doc-user-1',
      iat: 1000,
      exp: 2000,
      scope: 'ONBOARDING_ONLY',
    });
    redisClient.mget.mockResolvedValue([null, null]);
    prismaService.user.findUnique.mockResolvedValue({
      id: 'doc-user-1',
      role: 'DOCTOR',
      status: 'PENDING',
      familyUnit: null,
    });
    reflector.getAllAndOverride.mockImplementation((key: string) => {
      return key === ALLOW_ONBOARDING_KEY;
    });

    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
    const req = ctx.switchToHttp().getRequest() as any;
    expect(req.user.id).toBe('doc-user-1');
  });
});
