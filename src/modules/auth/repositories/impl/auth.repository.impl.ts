import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../core/database/prisma.service';
import { BasePrismaRepository } from '../../../../core/repository/base-prisma.repository';
import { CreateAuthDto } from '../../dtos/create-auth.dto';
import { UpdateAuthDto } from '../../dtos/update-auth.dto';
import {
  AuthEntity,
  AuthSessionRecord,
  CreateAuthSessionData,
  CreateFamilyRepDbData,
  IAuthRepository,
  OtpChallengePurposeType,
  OtpChallengeRecord,
  RotateAuthSessionInput,
  RotateAuthSessionResult,
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
        dateOfBirth: null,
        gender: null,
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
      data: { passwordHash, mustChangePassword: false },
    });
  }

  private toAuthSessionRecord(row: any): AuthSessionRecord {
    return row as AuthSessionRecord;
  }

  async createAuthSession(
    data: CreateAuthSessionData,
  ): Promise<AuthSessionRecord> {
    const row = await this.prismaService.authSession.create({
      data: {
        userId: data.userId,
        tokenHash: data.tokenHash,
        familyId: data.familyId,
        rememberMe: data.rememberMe,
        clientIp: data.clientIp ?? null,
        userAgent: data.userAgent ? data.userAgent.slice(0, 255) : null,
        expiresAt: data.expiresAt,
      },
    });
    return this.toAuthSessionRecord(row);
  }

  async findAuthSessionByTokenHash(
    tokenHash: string,
  ): Promise<AuthSessionRecord | null> {
    const row = await this.prismaService.authSession.findUnique({
      where: { tokenHash },
    });
    return row ? this.toAuthSessionRecord(row) : null;
  }

  async rotateAuthSession(
    input: RotateAuthSessionInput,
  ): Promise<RotateAuthSessionResult> {
    return this.prismaService.$transaction(async (tx) => {
      const now = new Date();
      const created = await tx.authSession.create({
        data: {
          userId: input.newSession.userId,
          tokenHash: input.newSession.tokenHash,
          familyId: input.newSession.familyId,
          rememberMe: input.newSession.rememberMe,
          clientIp: input.newSession.clientIp ?? null,
          userAgent: input.newSession.userAgent
            ? input.newSession.userAgent.slice(0, 255)
            : null,
          expiresAt: input.newSession.expiresAt,
        },
      });

      const updated = await tx.authSession.updateMany({
        where: {
          id: input.currentSessionId,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: {
          revokedAt: now,
          replacedBySessionId: created.id,
        },
      });

      if (updated.count === 0) {
        // Phát hiện reuse hoặc token hết hạn: thu hồi toàn bộ chuỗi familyId
        await tx.authSession.updateMany({
          where: {
            familyId: input.familyId,
            revokedAt: null,
          },
          data: { revokedAt: now },
        });
        return { rotated: false, session: null };
      }

      return { rotated: true, session: this.toAuthSessionRecord(created) };
    });
  }

  async revokeAuthSessionByTokenHash(tokenHash: string): Promise<void> {
    await this.prismaService.authSession.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAuthSessionById(sessionId: string): Promise<void> {
    await this.prismaService.authSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllUserAuthSessions(userId: string): Promise<void> {
    await this.prismaService.authSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async purgeExpiredAuthSessions(before = new Date()): Promise<number> {
    const res = await this.prismaService.authSession.deleteMany({
      where: { expiresAt: { lt: before } },
    });
    return res.count;
  }
}
