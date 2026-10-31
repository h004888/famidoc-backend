import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type Redis from 'ioredis';
import { PrismaService } from '../database/prisma.service';
import type { AuthenticatedRequest } from './authenticated-request';

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
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
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
    // Token đã logout phải bị chặn. Redis lỗi thì đóng quyền truy cập, không bỏ qua blacklist.
    let revoked: string | null;
    try {
      const [blacklist, passwordChangedAt] = await this.redis.mget(
        `blacklist:${claims.jti || match[1]}`,
        `token:revoked:${claims.sub}`,
      );
      // Thu hồi toàn bộ token cũ khi đổi mật khẩu, thống nhất với module auth mới pull.
      revoked =
        blacklist ||
        (passwordChangedAt && claims.iat <= Number(passwordChangedAt)
          ? 'password-changed'
          : null);
    } catch {
      throw new ServiceUnavailableException(
        'Token revocation service unavailable',
      );
    }
    if (revoked) throw new UnauthorizedException('Access token revoked');
    const user = await this.prisma.user.findUnique({
      where: { id: claims.sub },
      select: {
        id: true,
        role: true,
        status: true,
        familyUnit: { select: { id: true } },
      },
    });
    if (!user) throw new UnauthorizedException('Account not found');
    if (user.status !== 'ACTIVE' || claims.scope === 'ONBOARDING_ONLY')
      throw new ForbiddenException('Account is not active for this operation');
    // Dùng vai trò/gia đình từ DB hiện tại, không tin familyId hoặc role do client gửi.
    request.user = {
      id: user.id,
      role: user.role,
      familyUnitId: user.familyUnit?.id ?? null,
    };
    return true;
  }
}
