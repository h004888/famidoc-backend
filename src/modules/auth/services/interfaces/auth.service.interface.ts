import { CreateAuthDto } from '../../dtos/create-auth.dto';
import { UpdateAuthDto } from '../../dtos/update-auth.dto';
import { RegisterFamilyRepDto } from '../../dtos/register-family-rep.dto';
import { VerifyEmailOtpDto } from '../../dtos/verify-email-otp.dto';
import { ResendEmailOtpDto } from '../../dtos/resend-email-otp.dto';
import { LoginDto } from '../../dtos/login.dto';
import { ForgotPasswordDto } from '../../dtos/forgot-password.dto';
import { ResetPasswordDto } from '../../dtos/reset-password.dto';
import { ChangePasswordDto } from '../../dtos/change-password.dto';
import {
  RegisterInitiateResponse,
  LoginSuccessResponse,
  ApiResponseMessage,
} from '../../dtos/auth-responses.dto';
import { AuthEntity } from '../../repositories/interfaces/auth.repository.interface';

export const AUTH_SERVICE_TOKEN = Symbol('IAuthService');

export interface IAuthService {
  findAll(): Promise<AuthEntity[]>;
  findOne(id: string): Promise<AuthEntity>;
  create(dto: CreateAuthDto): Promise<AuthEntity>;
  update(id: string, dto: UpdateAuthDto): Promise<AuthEntity>;
  remove(id: string): Promise<AuthEntity>;

  registerFamilyRep(dto: RegisterFamilyRepDto): Promise<RegisterInitiateResponse>;
  resendEmailOtp(dto: ResendEmailOtpDto): Promise<ApiResponseMessage>;
  verifyEmailOtp(dto: VerifyEmailOtpDto): Promise<AuthEntity>;
  login(dto: LoginDto, clientIp?: string): Promise<LoginSuccessResponse>;
  logout(userId: string, token: string): Promise<void>;
  forgotPassword(dto: ForgotPasswordDto): Promise<ApiResponseMessage>;
  resetPassword(dto: ResetPasswordDto): Promise<ApiResponseMessage>;
  changePassword(userId: string, dto: ChangePasswordDto): Promise<ApiResponseMessage>;
}
