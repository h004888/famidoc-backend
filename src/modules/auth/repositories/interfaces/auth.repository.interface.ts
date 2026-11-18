import { IBaseRepository } from '../../../../core/repository/base.repository.interface';
import { CreateAuthDto } from '../../dtos/create-auth.dto';
import { UpdateAuthDto } from '../../dtos/update-auth.dto';

export const AUTH_REPOSITORY_TOKEN = Symbol('IAuthRepository');

export interface AuthEntity {
  id: string;
  email: string;
  phone: string;
  passwordHash: string;
  fullName: string;
  role: 'ADMIN' | 'HEALTHCARE_FACILITY' | 'DOCTOR' | 'FAMILY_REP';
  avatarUrl?: string | null;
  status: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'LOCKED';
  mustChangePassword?: boolean;
  failedLoginAttempts?: number;
  lockedUntil?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface CreateFamilyRepDbData {
  email: string;
  phone: string;
  passwordHash: string;
  fullName: string;
  homeAddress?: string;
}

export type OtpChallengePurposeType = 'REGISTER_FAMILY_REP' | 'RESET_PASSWORD';

export interface OtpChallengeRecord {
  id: string;
  purpose: OtpChallengePurposeType;
  email: string;
  phone?: string | null;
  payload?: Record<string, unknown> | null;
  otpHash: string;
  expiresAt: Date;
  cooldownUntil: Date;
  attempts: number;
  maxAttempts: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface UpsertOtpChallengeData {
  purpose: OtpChallengePurposeType;
  email: string;
  phone?: string | null;
  payload?: Record<string, unknown> | null;
  otpHash: string;
  expiresAt: Date;
  cooldownUntil: Date;
  attempts?: number;
  maxAttempts?: number;
}

export interface IAuthRepository
  extends IBaseRepository<AuthEntity, CreateAuthDto, UpdateAuthDto> {
  findByEmail(email: string): Promise<AuthEntity | null>;
  findByPhone(phone: string): Promise<AuthEntity | null>;
  createFamilyRepWithProfile(data: CreateFamilyRepDbData): Promise<AuthEntity>;
  completeFamilyRepRegistration(
    data: CreateFamilyRepDbData,
    challengeEmail: string,
  ): Promise<AuthEntity>;
  findOtpChallenge(
    purpose: OtpChallengePurposeType,
    email: string,
  ): Promise<OtpChallengeRecord | null>;
  upsertOtpChallenge(data: UpsertOtpChallengeData): Promise<OtpChallengeRecord>;
  incrementOtpChallengeAttempts(id: string): Promise<number>;
  deleteOtpChallenge(
    purpose: OtpChallengePurposeType,
    email: string,
  ): Promise<void>;
  updatePassword(userId: string, passwordHash: string): Promise<void>;
  updateFailedAttempts(
    userId: string,
    attempts: number,
    lockedUntil?: Date | null,
  ): Promise<void>;
  resetFailedAttempts(userId: string): Promise<void>;
}
