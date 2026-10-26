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
  role: 'GUEST' | 'FAMILY_REP' | 'DOCTOR' | 'HEALTHCARE_FACILITY' | 'ADMIN';
  status: 'PENDING_VERIFICATION' | 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';
  tokenVersion: number;
  familyUnitId?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface CreateFamilyRepDbData {
  email: string;
  phone: string;
  passwordHash: string;
  fullName: string;
}

export interface IAuthRepository
  extends IBaseRepository<AuthEntity, CreateAuthDto, UpdateAuthDto> {
  findByEmail(email: string): Promise<AuthEntity | null>;
  findByPhone(phone: string): Promise<AuthEntity | null>;
  createFamilyRepWithProfile(data: CreateFamilyRepDbData): Promise<AuthEntity>;
  updatePassword(userId: string, passwordHash: string): Promise<void>;
  incrementTokenVersion(userId: string): Promise<number>;
}
