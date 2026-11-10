import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../database/prisma.service';
import type { AuthenticatedRequest } from './authenticated-request';
import { ALLOW_ONBOARDING_KEY } from './allow-onboarding.decorator';

interface AccessClaims {
  sub: string;
  iat: number;
  exp: number;
  jti?: string;
  scope?: string;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    @Optional() private readonly reflector?: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const match = /^Bearer ([^\s]+)$/i.exec(
      request.headers.authorization ?? '',
    );
    if (!match) throw new UnauthorizedException('Bearer access token required');
    let claims: AccessClaims;
    try {
      claims = await this.jwt.verifyAsync<AccessClaims>(match[1], {
        algorithms: ['HS256'],
      });
      if (
        !claims.sub ||
        !Number.isInteger(claims.iat) ||
        !Number.isInteger(claims.exp)
      )
        throw new Error('Invalid claims');
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: claims.sub },
      include: {
        familyUnit: {
          select: { id: true },
        },
      },
    });
    if (!user)
      throw new UnauthorizedException('User account no longer exists');
    if (user.status === 'SUSPENDED')
      throw new ForbiddenException('Account has been suspended');
    const allowOnboarding = this.reflector?.getAllAndOverride<boolean>(
      ALLOW_ONBOARDING_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (user.status === 'PENDING' && !allowOnboarding) {
      if (user.role === 'DOCTOR') {
        throw new ForbiddenException(
          'Tài khoản Bác sĩ chưa được thẩm định phê duyệt hồ sơ chuyên môn.',
        );
      }
      throw new ForbiddenException(
        'Tài khoản chưa hoàn tất kích hoạt onboarding.',
      );
    }
    request.user = {
      id: user.id,
      role: user.role,
      familyUnitId: user.familyUnit?.id ?? null,
    };
    return true;
  }
}
