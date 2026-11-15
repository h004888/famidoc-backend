import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../core/database/prisma.service';
import { BasePrismaRepository } from '../../../../core/repository/base-prisma.repository';
import { CreateAuthDto } from '../../dtos/create-auth.dto';
import { UpdateAuthDto } from '../../dtos/update-auth.dto';
import {
  AuthEntity,
  CreateFamilyRepDbData,
  IAuthRepository,
  OtpChallengePurposeType,
  OtpChallengeRecord,
  UpsertOtpChallengeData,
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
    const cleanPhone = phone.trim();
    const user = await this.prismaService.user.findFirst({
      where: { phone: cleanPhone },
    });
    if (user) return (user as unknown as AuthEntity);

    let altPhone: string | null = null;
    if (cleanPhone.startsWith('0')) {
      altPhone = '+84' + cleanPhone.slice(1);
    } else if (cleanPhone.startsWith('+84')) {
      altPhone = '0' + cleanPhone.slice(3);
    }
    if (altPhone) {
      const altUser = await this.prismaService.user.findFirst({
        where: { phone: altPhone },
      });
      if (altUser) return (altUser as unknown as AuthEntity);
    }
    return null;
  }

  private async createFamilyRepEntities(
    tx: Prisma.TransactionClient,
    data: CreateFamilyRepDbData,
  ): Promise<AuthEntity> {
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
  }

  async createFamilyRepWithProfile(data: CreateFamilyRepDbData): Promise<AuthEntity> {
    return this.prismaService.$transaction((tx) =>
      this.createFamilyRepEntities(tx, data),
    );
  }

  /**
   * Tạo tài khoản đại diện gia đình cùng hồ sơ liên quan và xóa challenge OTP tạm
   * trong cùng một transaction để bảo đảm tính toàn vẹn dữ liệu.
   */
  async completeFamilyRepRegistration(
    data: CreateFamilyRepDbData,
    challengeEmail: string,
  ): Promise<AuthEntity> {
    return this.prismaService.$transaction(async (tx) => {
      const user = await this.createFamilyRepEntities(tx, data);
      await tx.otpChallenge.deleteMany({
        where: {
          purpose: 'REGISTER_FAMILY_REP',
          email: challengeEmail,
        },
      });
      return user;
    });
  }

  async findOtpChallenge(
    purpose: OtpChallengePurposeType,
    email: string,
  ): Promise<OtpChallengeRecord | null> {
    const row = await this.prismaService.otpChallenge.findUnique({
      where: {
        purpose_email: { purpose, email },
      },
    });
    return (row as unknown as OtpChallengeRecord) ?? null;
  }

  async upsertOtpChallenge(
    data: UpsertOtpChallengeData,
  ): Promise<OtpChallengeRecord> {
    const staleCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await this.prismaService.otpChallenge.deleteMany({
      where: { expiresAt: { lt: staleCutoff } },
    });

    const payloadValue = (data.payload ?? undefined) as
      | Prisma.InputJsonValue
      | undefined;

    const row = await this.prismaService.otpChallenge.upsert({
      where: {
        purpose_email: { purpose: data.purpose, email: data.email },
      },
      create: {
        purpose: data.purpose,
        email: data.email,
        phone: data.phone ?? null,
        payload: payloadValue,
        otpHash: data.otpHash,
        expiresAt: data.expiresAt,
        cooldownUntil: data.cooldownUntil,
        attempts: data.attempts ?? 0,
        maxAttempts: data.maxAttempts ?? 5,
      },
      update: {
        phone: data.phone ?? null,
        payload: payloadValue,
        otpHash: data.otpHash,
        expiresAt: data.expiresAt,
        cooldownUntil: data.cooldownUntil,
        attempts: data.attempts ?? 0,
        maxAttempts: data.maxAttempts ?? 5,
      },
    });
    return row as unknown as OtpChallengeRecord;
  }

  async incrementOtpChallengeAttempts(id: string): Promise<number> {
    const updated = await this.prismaService.otpChallenge.update({
      where: { id },
      data: { attempts: { increment: 1 } },
      select: { attempts: true },
    });
    return updated.attempts;
  }

  async deleteOtpChallenge(
    purpose: OtpChallengePurposeType,
    email: string,
  ): Promise<void> {
    await this.prismaService.otpChallenge.deleteMany({
      where: { purpose, email },
    });
  }

  async updatePassword(userId: string, passwordHash: string): Promise<void> {
    await this.prismaService.user.update({
      where: { id: userId },
      data: { passwordHash },
    });
  }

  async updateFailedAttempts(
    userId: string,
    attempts: number,
    lockedUntil?: Date | null,
  ): Promise<void> {
    await this.prismaService.user.update({
      where: { id: userId },
      data: {
        failedLoginAttempts: attempts,
        lockedUntil: lockedUntil ?? null,
      },
    });
  }

  async resetFailedAttempts(userId: string): Promise<void> {
    await this.prismaService.user.update({
      where: { id: userId },
      data: {
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });
  }
}
