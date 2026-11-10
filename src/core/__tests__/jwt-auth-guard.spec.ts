import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ALLOW_ONBOARDING_KEY } from '../auth/allow-onboarding.decorator';

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let jwtService: jest.Mocked<JwtService>;
  let prismaService: any;
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

    reflector = {
      getAllAndOverride: jest.fn(),
    } as any;

    guard = new JwtAuthGuard(jwtService, prismaService, reflector);
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

  it('should throw UnauthorizedException if token is invalid or expired', async () => {
    const ctx = createMockContext('Bearer token123');
    jwtService.verifyAsync.mockRejectedValue(new Error('jwt expired'));

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
    prismaService.user.findUnique.mockResolvedValue({
      id: 'user-1',
      role: 'FAMILY_REP',
      email: 'user@example.com',
      fullName: 'User One',
      status: 'ACTIVE',
      familyUnit: { id: 'fam-1' },
    });

    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
    const req = ctx.switchToHttp().getRequest();
    expect(req.user).toEqual({
      id: 'user-1',
      role: 'FAMILY_REP',
      familyUnitId: 'fam-1',
    });
  });

  it('should throw ForbiddenException if user status is SUSPENDED', async () => {
    const ctx = createMockContext('Bearer token123');
    jwtService.verifyAsync.mockResolvedValue({
      sub: 'user-1',
      iat: 1000,
      exp: 2000,
    });
    prismaService.user.findUnique.mockResolvedValue({
      id: 'user-1',
      status: 'SUSPENDED',
    });

    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('should throw ForbiddenException for PENDING doctor when onboarding is not allowed', async () => {
    const ctx = createMockContext('Bearer token123');
    jwtService.verifyAsync.mockResolvedValue({
      sub: 'doctor-1',
      iat: 1000,
      exp: 2000,
    });
    prismaService.user.findUnique.mockResolvedValue({
      id: 'doctor-1',
      status: 'PENDING',
      role: 'DOCTOR',
    });
    reflector.getAllAndOverride.mockReturnValue(false);

    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('should allow PENDING user if @AllowOnboarding decorator is set to true', async () => {
    const ctx = createMockContext('Bearer token123');
    jwtService.verifyAsync.mockResolvedValue({
      sub: 'user-1',
      iat: 1000,
      exp: 2000,
    });
    prismaService.user.findUnique.mockResolvedValue({
      id: 'user-1',
      role: 'FAMILY_REP',
      status: 'PENDING',
    });
    reflector.getAllAndOverride.mockReturnValue(true);

    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
  });
});
