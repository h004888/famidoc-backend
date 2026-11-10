import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  InternalServerErrorException,
  Optional,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomInt, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { JwtService } from '@nestjs/jwt';
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
import {
  BusinessConflictException,
  BaseApiException,
} from '../../../../core/exceptions/api.exception';
import { AuthErrorCode } from '../../../../core/constants/error-codes.constant';

import {
  AuthEntity,
  AUTH_REPOSITORY_TOKEN,
} from '../../repositories/interfaces/auth.repository.interface';
import type { IAuthRepository } from '../../repositories/interfaces/auth.repository.interface';
import type { IAuthService } from '../interfaces/auth.service.interface';
import { CreateAuthDto } from '../../dtos/create-auth.dto';
import { UpdateAuthDto } from '../../dtos/update-auth.dto';

@Injectable()
export class AuthServiceImpl implements IAuthService {
  constructor(
    @Inject(AUTH_REPOSITORY_TOKEN)
    private readonly authRepository: IAuthRepository,
    @Inject('MAILER_SERVICE')
    private readonly mailerService: any,
    private readonly jwtService: JwtService,
    @Optional()
    @Inject('REDIS_CLIENT')
    private readonly redisClient?: any,
  ) {}

  protected async hashPassword(password: string): Promise<string> {
    try {
      return await bcrypt.hash(password, 10);
    } catch {
      throw new InternalServerErrorException('Password hashing failed');
    }
  }

  protected async verifyPassword(
    plain: string,
    hash: string,
  ): Promise<boolean> {
    try {
      return await bcrypt.compare(plain, hash);
    } catch (err: any) {
      if (err instanceof InternalServerErrorException) throw err;
      throw new InternalServerErrorException('Password verification failed');
    }
  }

  async findAll(): Promise<AuthEntity[]> {
    return this.authRepository.findAll();
  }

  async findOne(id: string): Promise<AuthEntity> {
    const user = await this.authRepository.findById(id);
    if (!user) {
      throw new BadRequestException('User not found');
    }
    return user;
  }

  async create(dto: CreateAuthDto): Promise<AuthEntity> {
    return this.authRepository.create(dto);
  }

  async update(id: string, dto: UpdateAuthDto): Promise<AuthEntity> {
    return this.authRepository.update(id, dto);
  }

  async remove(id: string): Promise<AuthEntity> {
    return this.authRepository.delete(id);
  }

  async registerFamilyRepresentative(
    dto: RegisterFamilyRepDto,
  ): Promise<RegisterInitiateResponse> {
    const isTermsAccepted = dto.acceptTerms;
    if (!isTermsAccepted) {
      throw new BadRequestException('You must accept terms and privacy policy');
    }

    if (dto.confirmPassword && dto.confirmPassword !== dto.password) {
      throw new BadRequestException('Confirm password does not match password');
    }

    try {
      const existingEmail = await this.authRepository.findByEmail(dto.email);
      if (existingEmail) {
        throw new BusinessConflictException(
          AuthErrorCode.AUTH_EMAIL_ALREADY_EXISTS,
          'This email is already registered',
        );
      }

      const existingPhone = await this.authRepository.findByPhone(dto.phone);
      if (existingPhone) {
        throw new BusinessConflictException(
          AuthErrorCode.AUTH_PHONE_ALREADY_EXISTS,
          'This phone is already registered',
        );
      }

      const cooldown =
        this.redisClient && typeof this.redisClient.ttl === 'function'
          ? (await this.redisClient.ttl(`otp:cooldown:${dto.email}`)) || 0
          : 0;
      if (cooldown > 0) {
        throw new HttpException(
          `Please wait ${cooldown} seconds before requesting a new OTP`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      const passwordHash = await this.hashPassword(dto.password);

      // Lưu trực tiếp vào PostgreSQL
      await this.authRepository.createFamilyRepWithProfile({
        email: dto.email,
        phone: dto.phone,
        passwordHash,
        fullName: dto.fullName,
      });

      const otp = randomInt(100000, 1000000).toString();

      if (this.redisClient) {
        await this.redisClient.set?.(
          `otp:reg:${dto.email}`,
          JSON.stringify({
            fullName: dto.fullName,
            phone: dto.phone,
            passwordHash,
            otp,
          }),
          'EX',
          300,
        );
        await this.redisClient.set?.(`otp:cooldown:${dto.email}`, '1', 'EX', 60);
      }

      await this.mailerService.sendMail({
        to: dto.email,
        subject: 'FamiDoc - Chào mừng bạn gia nhập hệ thống chăm sóc sức khỏe gia đình',
        text: `Xin chào ${dto.fullName}, tài khoản đại diện gia đình của bạn đã được khởi tạo thành công trên hệ thống FamiDoc. Mã OTP xác thực (nếu cần): ${otp}. Bạn có thể đăng nhập ngay bằng email ${dto.email} hoặc số điện thoại ${dto.phone}.`,
      });

      return {
        email: dto.email,
        expiresInSeconds: 300,
        ...(process.env.NODE_ENV !== 'production' ? { devOtp: otp } : {}),
      };
    } catch (err: any) {
      if (
        err instanceof ConflictException ||
        err instanceof BadRequestException ||
        err instanceof HttpException
      ) {
        throw err;
      }
      if (err.code === 'P2002') {
        throw new BusinessConflictException(
          AuthErrorCode.AUTH_CONFLICT_ERROR,
          'This email/phone is already registered',
        );
      }
      throw new ServiceUnavailableException(
        'Service unavailable, please try again later',
      );
    }
  }

  async resendEmailOtp(dto: ResendEmailOtpDto): Promise<ApiResponseMessage> {
    const cooldown =
      this.redisClient && typeof this.redisClient.ttl === 'function'
        ? (await this.redisClient.ttl(`otp:cooldown:${dto.email}`)) || 0
        : 0;
    if (cooldown > 0) {
      throw new HttpException(
        `Please wait ${cooldown} seconds before requesting a new OTP`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (this.redisClient && typeof this.redisClient.get === 'function') {
      const cached = await this.redisClient.get(`otp:reg:${dto.email}`);
      if (cached) {
        const data = JSON.parse(cached);
        const newOtp = randomInt(100000, 1000000).toString();
        data.otp = newOtp;
        await this.redisClient.set?.(
          `otp:reg:${dto.email}`,
          JSON.stringify(data),
          'EX',
          300,
        );
        await this.redisClient.set?.(`otp:cooldown:${dto.email}`, '1', 'EX', 60);
      }
    }

    const newOtp = randomInt(100000, 1000000).toString();
    await this.mailerService.sendMail({
      to: dto.email,
      subject: 'FamiDoc - Gửi lại mã OTP xác thực',
      text: `Mã OTP mới của bạn là: ${newOtp}`,
    });

    return {
      message: 'Email sent successfully',
      success: true,
    };
  }

  async verifyEmailOtp(dto: VerifyEmailOtpDto): Promise<AuthEntity> {
    if (this.redisClient && typeof this.redisClient.get === 'function') {
      const cached = await this.redisClient.get(`otp:reg:${dto.email}`);
      if (cached) {
        const data = JSON.parse(cached);
        if (data.otp !== dto.otp) {
          throw new UnauthorizedException('Invalid or expired OTP');
        }
        if (!data.passwordHash) {
          throw new UnauthorizedException(
            'Registration expired; please register again',
          );
        }
        const user = await this.authRepository.createFamilyRepWithProfile({
          email: dto.email,
          phone: data.phone,
          passwordHash: data.passwordHash,
          fullName: data.fullName,
          homeAddress: data.homeAddress,
        });
        await this.redisClient.del?.(`otp:reg:${dto.email}`);
        return user;
      }
    }

    const user = await this.authRepository.findByEmail(dto.email);
    if (!user) {
      throw new UnauthorizedException('Invalid or expired OTP');
    }
    return user;
  }

  async login(
    dto: LoginDto,
    _clientIp?: string,
  ): Promise<LoginSuccessResponse> {
    const LOCKOUT_DURATION_SECONDS = 1800; // 30 minutes (SRS Security Section IV.2.3)
    const email = (dto.email || '').trim().toLowerCase();
    if (!email) {
      throw new BadRequestException('Vui lòng cung cấp email đăng nhập');
    }
    try {
      if (this.redisClient && typeof this.redisClient.get === 'function') {
        const isLocked = await this.redisClient.get(
          `login:lock:${email}`,
        );
        if (isLocked) {
          throw new ForbiddenException(
            'Account temporarily locked. Please try again in 30 minutes',
          );
        }
      }

      const user: AuthEntity | null = await this.authRepository.findByEmail(email);

      if (!user) {
        throw new UnauthorizedException(
          'Incorrect username or password. Please check again.',
        );
      }

      if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
        throw new ForbiddenException(
          'Account temporarily locked. Please try again in 30 minutes',
        );
      }

      if (
        user.status === 'SUSPENDED' ||
        user.status === 'LOCKED' ||
        (user.status === 'PENDING' && user.role !== 'DOCTOR')
      ) {
        throw new ForbiddenException(
          'Your account cannot be used to sign in. Please contact support.',
        );
      }

      const isValid = await this.verifyPassword(
        dto.password,
        user.passwordHash,
      );
      if (!isValid) {
        let failCount = (user.failedLoginAttempts || 0) + 1;
        if (this.redisClient && typeof this.redisClient.incr === 'function') {
          failCount = await this.redisClient.incr(`login:fail:${email}`);
          if (
            failCount === 1 &&
            typeof this.redisClient.expire === 'function'
          ) {
            await this.redisClient.expire(
              `login:fail:${email}`,
              LOCKOUT_DURATION_SECONDS,
            );
          }
        }
        const lockedUntil =
          failCount >= 5
            ? new Date(Date.now() + LOCKOUT_DURATION_SECONDS * 1000)
            : null;
        if (failCount >= 5 && this.redisClient) {
          await this.redisClient.set?.(
            `login:lock:${email}`,
            '1',
            'EX',
            LOCKOUT_DURATION_SECONDS,
          );
        }

        await this.authRepository.updateFailedAttempts(user.id, failCount, lockedUntil);

        throw new UnauthorizedException(
          'Incorrect username or password. Please check again.',
        );
      }

      if (this.redisClient) {
        await this.redisClient.del?.(`login:fail:${email}`);
      }

      if (user.failedLoginAttempts && user.failedLoginAttempts > 0) {
        await this.authRepository.resetFailedAttempts(user.id);
      }

      const payload: any = {
        sub: user.id,
        jti: randomUUID(),
        email: user.email,
        role: user.role,
      };

      if (user.role === 'DOCTOR' && user.status === 'PENDING') {
        payload.scope = 'ONBOARDING_ONLY';
      }

      const accessToken = this.jwtService.sign(payload);

      return {
        accessToken,
        role: user.role,
        user: {
          id: user.id,
          email: user.email,
          phone: user.phone,
          fullName: user.fullName,
          role: user.role,
          status: user.status,
          avatarUrl: user.avatarUrl,
        },
      };
    } catch (err: any) {
      if (
        err instanceof ForbiddenException ||
        err instanceof UnauthorizedException ||
        err instanceof BadRequestException
      ) {
        throw err;
      }
      throw new ServiceUnavailableException(
        'Authentication service unavailable',
      );
    }
  }

  async logout(_userId: string, token: string): Promise<ApiResponseMessage> {
    if (this.redisClient) {
      const rawToken = token.replace(/^Bearer\s+/i, '').trim();
      if (rawToken) {
        const decoded: any = this.jwtService.decode(rawToken);
        const ttl = decoded?.exp
          ? Math.max(decoded.exp - Math.floor(Date.now() / 1000), 60)
          : 3600;

        if (decoded?.jti) {
          await this.redisClient.set?.(
            `blacklist:${decoded.jti}`,
            'revoked',
            'EX',
            ttl,
          );
        }
        await this.redisClient.set?.(
          `blacklist:${rawToken}`,
          'revoked',
          'EX',
          ttl,
        );
      }
    }

    return {
      message: 'Logged out successfully',
      success: true,
    };
  }

  async requestForgotPassword(
    dto: ForgotPasswordDto,
  ): Promise<ApiResponseMessage> {
    const email = dto.email.trim().toLowerCase();
    const cooldown =
      this.redisClient && typeof this.redisClient.ttl === 'function'
        ? (await this.redisClient.ttl(`otp:cooldown:reset:${email}`)) || 0
        : 0;
    if (cooldown > 0) {
      throw new HttpException(
        `Please wait ${cooldown} seconds before requesting a new OTP`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const user = await this.authRepository.findByEmail(email);
    if (!user) {
      return {
        message: `A confirmation email has been sent to ${email}`,
        success: true,
      };
    }

    const otp = randomInt(100000, 1000000).toString();
    if (this.redisClient) {
      await this.redisClient.set?.(`otp:reset:${email}`, otp, 'EX', 600);
      await this.redisClient.set?.(`otp:cooldown:reset:${email}`, '1', 'EX', 60);
    }

    await this.mailerService.sendMail({
      to: email,
      subject: 'FamiDoc - Yêu cầu khôi phục mật khẩu',
      text: `Mã OTP đặt lại mật khẩu của bạn là: ${otp} (hiệu lực 10 phút). Vui lòng không chia sẻ mã này cho bất kỳ ai.`,
    });

    return {
      message: `A confirmation email has been sent to ${email}`,
      success: true,
      ...(process.env.NODE_ENV !== 'production' ? { devOtp: otp } : {}),
    };
  }

  async forgotPassword(dto: ForgotPasswordDto): Promise<ApiResponseMessage> {
    return this.requestForgotPassword(dto);
  }

  async resetPassword(dto: ResetPasswordDto): Promise<ApiResponseMessage> {
    const email = dto.email.trim().toLowerCase();
    if (this.redisClient && typeof this.redisClient.get === 'function') {
      const cachedOtp = await this.redisClient.get(`otp:reset:${email}`);
      if (!cachedOtp || cachedOtp !== dto.otp) {
        throw new UnauthorizedException('Invalid or expired OTP');
      }
    }

    const user = await this.authRepository.findByEmail(email);
    if (!user) {
      throw new BadRequestException('User not found');
    }

    const newHash = await this.hashPassword(dto.newPassword);
    await this.authRepository.updatePassword(user.id, newHash);
    if (this.redisClient) {
      await this.redisClient.set?.(
        `token:revoked:${user.id}`,
        Math.floor(Date.now() / 1000).toString(),
        'EX',
        7 * 86400,
      );
      await this.redisClient.del?.(`otp:reset:${email}`);
      await this.redisClient.del?.(`otp:cooldown:reset:${email}`);
      await this.redisClient.del?.(`login:lock:${email}`);
      await this.redisClient.del?.(`login:fail:${email}`);
      if (user.phone) {
        await this.redisClient.del?.(`login:lock:${user.phone}`);
        await this.redisClient.del?.(`login:fail:${user.phone}`);
      }
    }

    if (user.failedLoginAttempts && user.failedLoginAttempts > 0) {
      await this.authRepository.resetFailedAttempts(user.id);
    }

    return {
      message: 'Update password successfully',
      success: true,
    };
  }

  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
  ): Promise<ApiResponseMessage> {
    if (dto.oldPassword === dto.newPassword) {
      throw new BadRequestException(
        'New password cannot be the same as current password',
      );
    }

    const user = await this.authRepository.findById(userId);
    if (!user) {
      throw new BadRequestException('User not found');
    }

    let isMatch = false;
    try {
      isMatch = await this.verifyPassword(dto.oldPassword, user.passwordHash);
    } catch {
      throw new InternalServerErrorException('Password verification failed');
    }
    if (!isMatch) {
      throw new BadRequestException('Current password is not correct');
    }

    const newHash = await this.hashPassword(dto.newPassword);
    await this.authRepository.updatePassword(userId, newHash);
    if (this.redisClient) {
      await this.redisClient.set?.(
        `token:revoked:${userId}`,
        Math.floor(Date.now() / 1000).toString(),
        'EX',
        7 * 86400,
      );
      if (user.email) {
        await this.redisClient.del?.(`login:lock:${user.email}`);
        await this.redisClient.del?.(`login:fail:${user.email}`);
      }
      if (user.phone) {
        await this.redisClient.del?.(`login:lock:${user.phone}`);
        await this.redisClient.del?.(`login:fail:${user.phone}`);
      }
    }

    if (user.failedLoginAttempts && user.failedLoginAttempts > 0) {
      await this.authRepository.resetFailedAttempts(user.id);
    }

    return {
      message: 'Update password successfully',
      success: true,
    };
  }
}
