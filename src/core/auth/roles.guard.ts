import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserRole } from '@prisma/client';
import type { AuthenticatedRequest } from './authenticated-request';

export const Roles = (...roles: UserRole[]) =>
  SetMetadata('allowedRoles', roles);

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<UserRole[]>('allowedRoles', [
      context.getHandler(),
      context.getClass(),
    ]);
    const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user;
    if (!user || (roles && !roles.includes(user.role)))
      throw new ForbiddenException('Insufficient role');
    return true;
  }
}
