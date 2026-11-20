import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Optional,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../database/prisma.service';
import type { AuthenticatedRequest } from './authenticated-request';

interface AccessClaims {
  sub: string;
  iat: number;
  exp: number;
}

/**
 * Guard cho phép cả khách vãng lai lẫn người dùng đã đăng nhập:
 * nếu có Bearer token hợp lệ thì gắn `req.user`, ngược lại bỏ qua để đi tiếp.
 */
@Injectable()
export class OptionalJwtAuthGuard implements CanActivate {
  constructor(
    @Optional() private readonly jwt?: JwtService,
    @Optional() private readonly prisma?: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const match = /^Bearer ([^\s]+)$/i.exec(
      request.headers.authorization ?? '',
    );
    if (!match || !this.jwt || !this.prisma) {
      return true;
    }

    try {
      const claims = await this.jwt.verifyAsync<AccessClaims>(match[1], {
        algorithms: ['HS256'],
      });
      if (!claims.sub) return true;

      const user = await this.prisma.user.findUnique({
        where: { id: claims.sub },
        include: { familyUnit: { select: { id: true } } },
      });
      if (!user || user.status !== 'ACTIVE') return true;

      request.user = {
        id: user.id,
        role: user.role,
        familyUnitId: user.familyUnit?.id ?? null,
      };
    } catch {
      // Token hết hạn hoặc không hợp lệ ở route public -> coi như khách vãng lai
    }

    return true;
  }
}
