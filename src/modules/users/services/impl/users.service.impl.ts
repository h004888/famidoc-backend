import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  USERS_REPOSITORY_TOKEN,
  type IUsersRepository,
} from '../../repositories/interfaces/users.repository.interface';
import type { IUsersService } from '../interfaces/users.service.interface';
import type { UpdateProfileDto } from '../../dtos/update-profile.dto';
@Injectable()
export class UsersServiceImpl implements IUsersService {
  constructor(
    @Inject(USERS_REPOSITORY_TOKEN)
    private readonly repository: IUsersRepository,
  ) {}
  async getCurrentUserProfile(userId: string) {
    const user = await this.repository.findProfile(userId);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }
  updateUserProfile(userId: string, dto: UpdateProfileDto) {
    if (dto.fullName === undefined && dto.avatarUrl === undefined)
      throw new BadRequestException('Provide fullName or avatarUrl');
    // userId luôn lấy từ JWT guard; không có tham số để sửa hồ sơ người khác.
    return this.repository.updateUserProfile(userId, dto);
  }
}
