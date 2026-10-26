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
      // 1. Tạo FamilyUnit
      const family = await tx.familyUnit.create({
        data: {
          emergencyPhone: data.phone,
        },
      });

      // 2. Tạo User đại diện gắn vào familyUnit
      const user = await tx.user.create({
        data: {
          email: data.email,
          phone: data.phone,
          passwordHash: data.passwordHash,
          fullName: data.fullName,
          role: 'FAMILY_REP',
          status: 'ACTIVE',
          tokenVersion: 1,
          familyUnitId: family.id,
        },
      });

      // 3. Tạo Patient chủ hộ theo quy tắc BR-05
      const patient = await tx.patient.create({
        data: {
          familyUnitId: family.id,
          fullName: data.fullName,
          relationshipToHead: 'SELF',
        },
      });

      // 4. Cập nhật HeadOfFamily_PatientID vào FamilyUnit
      await tx.familyUnit.update({
        where: { id: family.id },
        data: { headOfFamilyPatientId: patient.id },
      });

      // 5. Ghi Audit Log GB-16
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: 'REGISTER_FAMILY_REP',
          details: `Registered family representative ${data.email}`,
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

  async incrementTokenVersion(userId: string): Promise<number> {
    const updated = await this.prismaService.user.update({
      where: { id: userId },
      data: {
        tokenVersion: {
          increment: 1,
        },
      },
    });
    return updated.tokenVersion;
  }
}
