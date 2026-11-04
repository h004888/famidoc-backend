import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../core/database/prisma.service';
import {
  profileSelect,
  type IUsersRepository,
} from '../interfaces/users.repository.interface';
import type { UpdateProfileDto } from '../../dtos/update-profile.dto';
@Injectable()
export class UsersRepositoryImpl implements IUsersRepository {
  constructor(private readonly prisma: PrismaService) {}
  findProfile(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      select: profileSelect,
    });
  }
  updateUserProfile(id: string, dto: UpdateProfileDto) {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id },
        data: dto,
        select: profileSelect,
      });
      // Chỉ ghi loại thao tác và ID, không chép mật khẩu hay hồ sơ y tế vào audit log.
      await tx.auditLog.create({
        data: {
          actorUserId: id,
          action: 'UPDATE_OWN_PROFILE',
          resourceName: 'users',
          resourceId: id,
          clientIp: 'unknown',
        },
      });
      return user;
    });
  }
}
