import type { UpdateProfileDto } from '../../dtos/update-profile.dto';
import type { UserProfile } from '../../repositories/interfaces/users.repository.interface';
export const USERS_SERVICE_TOKEN = Symbol('USERS_SERVICE');
export interface IUsersService {
  getCurrentUserProfile(userId: string): Promise<UserProfile>;
  updateUserProfile(
    userId: string,
    dto: UpdateProfileDto,
  ): Promise<UserProfile>;
}
