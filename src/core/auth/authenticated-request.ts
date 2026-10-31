import type { Request } from 'express';
import type { UserRole } from '@prisma/client';

export interface AuthenticatedUser {
  id: string;
  role: UserRole;
  familyUnitId: string | null;
}
export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}
