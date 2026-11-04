import type { Prisma } from '@prisma/client';
import type { UpdateProfileDto } from '../../dtos/update-profile.dto';
// Select tường minh để passwordHash/lock state không bao giờ lọt vào JSON phản hồi.
export const profileSelect = {
  id: true,
  email: true,
  phone: true,
  fullName: true,
  avatarUrl: true,
  role: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;
export type UserProfile = Prisma.UserGetPayload<{
  select: typeof profileSelect;
}>;
export const USERS_REPOSITORY_TOKEN = Symbol('USERS_REPOSITORY');
export interface IUsersRepository {
  findProfile(id: string): Promise<UserProfile | null>;
  updateUserProfile(id: string, dto: UpdateProfileDto): Promise<UserProfile>;
}
