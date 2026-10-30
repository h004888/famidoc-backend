import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../core/database/prisma.service';
import { BasePrismaRepository } from '../../../../core/repository/base-prisma.repository';
import { CreateAuthDto } from '../../dtos/create-auth.dto';
import { UpdateAuthDto } from '../../dtos/update-auth.dto';
import {
  AuthEntity,
  CreateFamilyRepDbData,
  IAuthRepository,
} from '../interfaces/auth.repository.interface';

@Injectable()
export class AuthRepositoryImpl
  extends BasePrismaRepository<AuthEntity, CreateAuthDto, UpdateAuthDto>
  implements IAuthRepository
{
  constructor(private readonly prismaService: PrismaService) {
    super(prismaService.user);
  }

  async findByEmail(email: string): Promise<AuthEntity | null> {
    const user = await this.prismaService.user.findUnique({
      where: { email },
    });
    return (user as unknown as AuthEntity) ?? null;
  }

  async findByPhone(phone: string): Promise<AuthEntity | null> {
    const user = await this.prismaService.user.findFirst({
      where: { phone },
    });
    return (user as unknown as AuthEntity) ?? null;
  }

  async createFamilyRepWithProfile(data: CreateFamilyRepDbData): Promise<AuthEntity> {
    return this.prismaService.$transaction(async (tx) => {
      // 1. Tạo User đại diện theo chuẩn 3NF
      const user = await tx.user.create({
        data: {
          email: data.email,
          phone: data.phone,
          passwordHash: data.passwordHash,
          fullName: data.fullName,
          role: 'FAMILY_REP',
          status: 'ACTIVE',
        },
      });

      // 2. Tạo FamilyUnit gắn với representative_user_id (User.id)
      const family = await tx.familyUnit.create({
        data: {
          representativeUserId: user.id,
          homeAddress: data.homeAddress || 'Chưa cập nhật địa chỉ',
          emergencyPhone: data.phone,
          status: 'ACTIVE',
        },
      });

      // 3. Tạo Patient chủ hộ theo quy tắc BR-05 (gắn familyId)
      await tx.patient.create({
        data: {
          familyId: family.id,
          fullName: data.fullName,
          relationshipToHead: 'SELF',
          dateOfBirth: new Date('1990-01-01'),
          gender: 'OTHER',
          status: 'ACTIVE',
        },
      });

      // 4. Ghi Audit Log GB-16 & ISO 27799
      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          action: 'REGISTER_FAMILY_REP',
          resourceName: 'users',
          resourceId: user.id,
          clientIp: '127.0.0.1',
        },
      });

      return user as unknown as AuthEntity;
    });
  }

  async updatePassword(userId: string, passwordHash: string): Promise<void> {
    await this.prismaService.user.update({
      where: { id: userId },
      data: { passwordHash },
    });
  }
}
