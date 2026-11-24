import { compareSync, hashSync } from 'bcryptjs';
import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  InternalServerErrorException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthServiceImpl } from '../services/impl/auth.service.impl';
import {
  AUTH_REPOSITORY_TOKEN,
  IAuthRepository,
} from '../repositories/interfaces/auth.repository.interface';
import { JwtService } from '@nestjs/jwt';

describe('AuthServiceImpl', () => {
  let service: AuthServiceImpl;
  let repository: jest.Mocked<IAuthRepository>;
  let redisService: any;
  let mailerService: any;
  let jwtService: any;

  beforeEach(async () => {
    repository = {
      findAll: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findByEmail: jest.fn(),
      findByPhone: jest.fn(),
      createFamilyRepWithProfile: jest.fn(),
      completeFamilyRepRegistration: jest.fn(),
      findOtpChallenge: jest.fn(),
      upsertOtpChallenge: jest.fn(),
      incrementOtpChallengeAttempts: jest.fn(),
      deleteOtpChallenge: jest.fn(),
      updatePassword: jest.fn(),
      createAuthSession: jest.fn().mockResolvedValue({
        id: 'session-1',
        userId: 'user-1',
        tokenHash: 'hash',
        familyId: 'fam-1',
        rememberMe: false,
        expiresAt: new Date(Date.now() + 86400_000),
        createdAt: new Date(),
      }),
      findAuthSessionByTokenHash: jest.fn(),
      rotateAuthSession: jest.fn(),
      revokeAuthSessionByTokenHash: jest.fn(),
      revokeAuthSessionById: jest.fn(),
      revokeAllUserAuthSessions: jest.fn(),
      purgeExpiredAuthSessions: jest.fn(),
    };

    redisService = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      incr: jest.fn(),
      ttl: jest.fn(),
    };

    mailerService = {
      sendMail: jest.fn(),
    };

    jwtService = {
      sign: jest.fn(),
      decode: jest.fn(),
      verify: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthServiceImpl,
        {
          provide: AUTH_REPOSITORY_TOKEN,
          useValue: repository,
        },
        {
          provide: 'REDIS_CLIENT',
          useValue: redisService,
        },
        {
          provide: 'MAILER_SERVICE',
          useValue: mailerService,
        },
        {
          provide: JwtService,
          useValue: jwtService,
        },
      ],
    }).compile();

    service = module.get<AuthServiceImpl>(AuthServiceImpl);
  });

  it('được khởi tạo thành công', () => {
    expect(service).toBeDefined();
  });

  // --- UC-01 REGISTER ---
  it('[UT-S-01] Khởi tạo đăng ký Family Rep thành công (lưu tạm vào otp_challenges và gửi OTP qua Email)', async () => {
    repository.findByEmail.mockResolvedValue(null);
    repository.findByPhone.mockResolvedValue(null);
    repository.findOtpChallenge.mockResolvedValue(null);
    repository.upsertOtpChallenge.mockResolvedValue({} as any);
    mailerService.sendMail.mockResolvedValue(true);

    const res = await service.registerFamilyRepresentative({
      fullName: 'Nguyen Van A',
      phone: '0912345678',
      email: 'a@famidoc.vn',
      password: 'Password@123',
      confirmPassword: 'Password@123',
      acceptTerms: true,
    });

    expect(res.expiresInSeconds).toBe(300);
    expect(res.email).toBe('a@famidoc.vn');
    expect(repository.createFamilyRepWithProfile).not.toHaveBeenCalled();
    expect(repository.completeFamilyRepRegistration).not.toHaveBeenCalled();
    expect(repository.upsertOtpChallenge).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: 'REGISTER_FAMILY_REP',
        email: 'a@famidoc.vn',
        phone: '0912345678',
      }),
    );
    expect(mailerService.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'a@famidoc.vn',
        text: expect.any(String),
        html: expect.any(String),
      }),
    );
  });

  it('[UT-S-01b] registerFamilyRepresentative băm mật khẩu và OTP an toàn trước khi lưu tạm', async () => {
    repository.findByEmail.mockResolvedValue(null);
    repository.findByPhone.mockResolvedValue(null);
    repository.findOtpChallenge.mockResolvedValue(null);
    repository.upsertOtpChallenge.mockResolvedValue({} as any);
    mailerService.sendMail.mockResolvedValue(true);

    const res = await service.registerFamilyRepresentative({
      fullName: 'Nguyen Van A',
      phone: '0912345678',
      email: 'rep@famidoc.vn',
      password: 'Password@123',
      acceptTerms: true,
    });

    expect(res.expiresInSeconds).toBe(300);
    expect(res.email).toBe('rep@famidoc.vn');
    const saved = repository.upsertOtpChallenge.mock.calls[0][0];
    expect(saved.payload?.fullName).toBe('Nguyen Van A');
    expect(saved.payload?.password).toBeUndefined();
    expect(compareSync('Password@123', String(saved.payload?.passwordHash))).toBe(true);
    expect(saved.otpHash).toMatch(/^[a-f0-9]{64}$/);
    expect(mailerService.sendMail).toHaveBeenCalled();
  });

  it('[UT-S-01c] Khi gửi email thất bại ở bước đăng ký, hoàn nguyên challenge tạm và cho phép thử lại không bị 409/429', async () => {
    repository.findByEmail.mockResolvedValue(null);
    repository.findByPhone.mockResolvedValue(null);
    repository.findOtpChallenge.mockResolvedValue(null);
    repository.upsertOtpChallenge.mockResolvedValue({} as any);
    repository.deleteOtpChallenge.mockResolvedValue(undefined);
    mailerService.sendMail.mockRejectedValueOnce(new ServiceUnavailableException('Mail down'));

    await expect(
      service.registerFamilyRepresentative({
        fullName: 'Nguyen Van A',
        phone: '0912345678',
        email: 'retry@famidoc.vn',
        password: 'Password@123',
        acceptTerms: true,
      }),
    ).rejects.toThrow(ServiceUnavailableException);

    expect(repository.createFamilyRepWithProfile).not.toHaveBeenCalled();
    expect(repository.deleteOtpChallenge).toHaveBeenCalledWith(
      'REGISTER_FAMILY_REP',
      'retry@famidoc.vn',
    );

    mailerService.sendMail.mockResolvedValueOnce(true);
    const retryRes = await service.registerFamilyRepresentative({
      fullName: 'Nguyen Van A',
      phone: '0912345678',
      email: 'retry@famidoc.vn',
      password: 'Password@123',
      acceptTerms: true,
    });
    expect(retryRes.email).toBe('retry@famidoc.vn');
  });

  it('[UT-S-01d] Từ chối đăng ký lại cùng email bằng 429 khi vẫn đang trong thời gian cooldown 60s', async () => {
    repository.findByEmail.mockResolvedValue(null);
    repository.findByPhone.mockResolvedValue(null);
    repository.findOtpChallenge.mockResolvedValue({
      id: 'ch-active',
      purpose: 'REGISTER_FAMILY_REP',
      email: 'pending@famidoc.vn',
      phone: '0912345678',
      payload: { fullName: 'Nguyen Van A', passwordHash: 'h' },
      otpHash: 'old-hash',
      expiresAt: new Date(Date.now() + 240_000),
      cooldownUntil: new Date(Date.now() + 30_000),
      attempts: 0,
      maxAttempts: 5,
    });

    await expect(
      service.registerFamilyRepresentative({
        fullName: 'Nguyen Van A',
        phone: '0912345678',
        email: 'pending@famidoc.vn',
        password: 'Password@123',
        acceptTerms: true,
      }),
    ).rejects.toThrow(HttpException);
    expect(repository.upsertOtpChallenge).not.toHaveBeenCalled();
  });

  it('[UT-S-01e] Cho phép đăng ký lại cùng email và ghi đè challenge khi cooldown 60s đã hết', async () => {
    repository.findByEmail.mockResolvedValue(null);
    repository.findByPhone.mockResolvedValue(null);
    repository.findOtpChallenge.mockResolvedValue({
      id: 'ch-expired-cd',
      purpose: 'REGISTER_FAMILY_REP',
      email: 'pending@famidoc.vn',
      phone: '0912345678',
      payload: { fullName: 'Old Name', passwordHash: 'old-h' },
      otpHash: 'old-hash',
      expiresAt: new Date(Date.now() + 180_000),
      cooldownUntil: new Date(Date.now() - 5_000),
      attempts: 1,
      maxAttempts: 5,
    });
    repository.upsertOtpChallenge.mockResolvedValue({} as any);
    mailerService.sendMail.mockResolvedValue(true);

    const res = await service.registerFamilyRepresentative({
      fullName: 'New Name',
      phone: '0912345678',
      email: 'pending@famidoc.vn',
      password: 'Password@123',
      acceptTerms: true,
    });

    expect(res.email).toBe('pending@famidoc.vn');
    expect(repository.upsertOtpChallenge).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: 'REGISTER_FAMILY_REP',
        email: 'pending@famidoc.vn',
        payload: expect.objectContaining({ fullName: 'New Name' }),
      }),
    );
    expect(mailerService.sendMail).toHaveBeenCalledTimes(1);
  });

  it('[UT-S-02] Từ chối đăng ký do Email đã tồn tại', async () => {
    repository.findByEmail.mockResolvedValue({ id: '1' } as any);

    await expect(
      service.registerFamilyRepresentative({
        fullName: 'Nguyen Van A',
        phone: '0912345678',
        email: 'a@famidoc.vn',
        password: 'Password@123',
        acceptTerms: true,
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('[UT-S-03] Từ chối đăng ký do Số điện thoại đã tồn tại', async () => {
    repository.findByEmail.mockResolvedValue(null);
    repository.findByPhone.mockResolvedValue({ id: '1' } as any);

    await expect(
      service.registerFamilyRepresentative({
        fullName: 'Nguyen Van A',
        phone: '0912345678',
        email: 'a@famidoc.vn',
        password: 'Password@123',
        acceptTerms: true,
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('[UT-S-04] Từ chối đăng ký do chưa tích chọn cam kết Điều khoản / NĐ13', async () => {
    await expect(
      service.registerFamilyRepresentative({
        fullName: 'Nguyen Van A',
        phone: '0912345678',
        email: 'a@famidoc.vn',
        password: 'Password@123',
        acceptTerms: false,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('[UT-S-04b] Từ chối đăng ký do confirmPassword không khớp với password', async () => {
    await expect(
      service.registerFamilyRepresentative({
        fullName: 'Nguyen Van A',
        phone: '0912345678',
        email: 'a@famidoc.vn',
        password: 'Password@123',
        confirmPassword: 'Mismatch@999',
        acceptTerms: true,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('[UT-S-05] Xác thực Email OTP đăng ký thành công (Khởi tạo tài khoản và xóa challenge)', async () => {
    const otpHash = (service as any).hashOtp('REGISTER_FAMILY_REP', 'a@famidoc.vn', '123456');
    repository.findOtpChallenge.mockResolvedValue({
      id: 'ch-1',
      purpose: 'REGISTER_FAMILY_REP',
      email: 'a@famidoc.vn',
      phone: '0912345678',
      payload: {
        fullName: 'Nguyen Van A',
        passwordHash: hashSync('Password@123', 4),
        homeAddress: 'Số 10 Phố Huế, Hà Nội',
      },
      otpHash,
      expiresAt: new Date(Date.now() + 120_000),
      cooldownUntil: new Date(Date.now() + 30_000),
      attempts: 0,
      maxAttempts: 5,
    });
    repository.completeFamilyRepRegistration.mockResolvedValue({
      id: 'u-1',
      email: 'a@famidoc.vn',
      role: 'FAMILY_REP',
      status: 'ACTIVE',
    } as any);

    const user = await service.verifyEmailOtp({
      email: 'a@famidoc.vn',
      otp: '123456',
    });
    expect(user.id).toBe('u-1');
    expect(repository.completeFamilyRepRegistration).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'a@famidoc.vn',
        phone: '0912345678',
        homeAddress: 'Số 10 Phố Huế, Hà Nội',
      }),
      'a@famidoc.vn',
    );
  });

  it('[UT-S-06] Xác thực Email OTP thất bại do mã OTP sai và tăng số lần thử sai', async () => {
    const otpHash = (service as any).hashOtp('REGISTER_FAMILY_REP', 'a@famidoc.vn', '123456');
    repository.findOtpChallenge.mockResolvedValue({
      id: 'ch-1',
      purpose: 'REGISTER_FAMILY_REP',
      email: 'a@famidoc.vn',
      phone: '0912345678',
      payload: {
        fullName: 'Nguyen Van A',
        passwordHash: hashSync('Password@123', 4),
      },
      otpHash,
      expiresAt: new Date(Date.now() + 120_000),
      cooldownUntil: new Date(Date.now() + 30_000),
      attempts: 0,
      maxAttempts: 5,
    });

    await expect(
      service.verifyEmailOtp({ email: 'a@famidoc.vn', otp: '999999' }),
    ).rejects.toThrow(UnauthorizedException);
    expect(repository.incrementOtpChallengeAttempts).toHaveBeenCalledWith('ch-1');
    expect(repository.completeFamilyRepRegistration).not.toHaveBeenCalled();
  });

  it('[UT-S-06b] Xác thực Email OTP bị từ chối khi nhập sai vượt quá maxAttempts', async () => {
    const otpHash = (service as any).hashOtp('REGISTER_FAMILY_REP', 'a@famidoc.vn', '123456');
    repository.findOtpChallenge.mockResolvedValue({
      id: 'ch-1',
      purpose: 'REGISTER_FAMILY_REP',
      email: 'a@famidoc.vn',
      phone: '0912345678',
      payload: {
        fullName: 'Nguyen Van A',
        passwordHash: hashSync('Password@123', 4),
      },
      otpHash,
      expiresAt: new Date(Date.now() + 120_000),
      cooldownUntil: new Date(Date.now() + 30_000),
      attempts: 5,
      maxAttempts: 5,
    });

    await expect(
      service.verifyEmailOtp({ email: 'a@famidoc.vn', otp: '123456' }),
    ).rejects.toThrow(UnauthorizedException);
    expect(repository.completeFamilyRepRegistration).not.toHaveBeenCalled();
  });

  it('[UT-S-07] Xác thực Email OTP thất bại do OTP hết hạn hoặc không tồn tại', async () => {
    repository.findOtpChallenge.mockResolvedValue(null);

    await expect(
      service.verifyEmailOtp({ email: 'a@famidoc.vn', otp: '123456' }),
    ).rejects.toThrow(UnauthorizedException);
    expect(repository.completeFamilyRepRegistration).not.toHaveBeenCalled();
  });

  it('[UT-S-08] Gửi lại OTP bị từ chối do còn trong thời gian Cooldown (< 60s)', async () => {
    repository.findOtpChallenge.mockResolvedValue({
      id: 'ch-1',
      purpose: 'REGISTER_FAMILY_REP',
      email: 'a@famidoc.vn',
      phone: '0912345678',
      payload: { fullName: 'A', passwordHash: 'h' },
      otpHash: 'hash',
      expiresAt: new Date(Date.now() + 200_000),
      cooldownUntil: new Date(Date.now() + 45_000),
      attempts: 0,
      maxAttempts: 5,
    });

    await expect(
      service.resendEmailOtp({ email: 'a@famidoc.vn' }),
    ).rejects.toThrow(HttpException);
  });

  it('[UT-S-09] Gửi lại OTP thành công khi hết Cooldown và đồng nhất đúng 1 mã OTP giữa DB và Email', async () => {
    repository.findOtpChallenge.mockResolvedValue({
      id: 'ch-1',
      purpose: 'REGISTER_FAMILY_REP',
      email: 'a@famidoc.vn',
      phone: '0912345678',
      payload: { fullName: 'Nguyen Van A', passwordHash: 'h' },
      otpHash: 'old-hash',
      expiresAt: new Date(Date.now() + 200_000),
      cooldownUntil: new Date(Date.now() - 5_000),
      attempts: 2,
      maxAttempts: 5,
    });
    repository.upsertOtpChallenge.mockResolvedValue({} as any);
    mailerService.sendMail.mockResolvedValue(true);

    const res = await service.resendEmailOtp({ email: 'a@famidoc.vn' });
    expect(res.success).toBe(true);
    expect(repository.upsertOtpChallenge).toHaveBeenCalledTimes(1);
    expect(mailerService.sendMail).toHaveBeenCalledTimes(1);

    const savedHash = repository.upsertOtpChallenge.mock.calls[0][0].otpHash;
    const sentMailText = String(mailerService.sendMail.mock.calls[0][0].text);
    const otpMatch = /\b(\d{6})\b/.exec(sentMailText);
    expect(otpMatch).not.toBeNull();
    expect(
      (service as any).verifyOtpHash(
        'REGISTER_FAMILY_REP',
        'a@famidoc.vn',
        otpMatch![1],
        savedHash,
      ),
    ).toBe(true);
  });

  it('[UT-S-09b] resendEmailOtp khôi phục lại otpHash và cooldownUntil cũ khi sendMail lỗi', async () => {
    const prevExpiresAt = new Date(Date.now() + 180_000);
    const prevCooldownUntil = new Date(Date.now() - 5_000);
    repository.findOtpChallenge.mockResolvedValue({
      id: 'ch-1',
      purpose: 'REGISTER_FAMILY_REP',
      email: 'a@famidoc.vn',
      phone: '0912345678',
      payload: { fullName: 'Nguyen Van A', passwordHash: 'h' },
      otpHash: 'prev-otp-hash',
      expiresAt: prevExpiresAt,
      cooldownUntil: prevCooldownUntil,
      attempts: 2,
      maxAttempts: 5,
    });
    repository.upsertOtpChallenge.mockResolvedValue({} as any);
    mailerService.sendMail.mockRejectedValueOnce(new Error('Mail timeout'));

    await expect(
      service.resendEmailOtp({ email: 'a@famidoc.vn' }),
    ).rejects.toThrow(ServiceUnavailableException);

    expect(repository.upsertOtpChallenge).toHaveBeenCalledTimes(2);
    expect(repository.upsertOtpChallenge).toHaveBeenLastCalledWith(
      expect.objectContaining({
        purpose: 'REGISTER_FAMILY_REP',
        email: 'a@famidoc.vn',
        otpHash: 'prev-otp-hash',
        expiresAt: prevExpiresAt,
        cooldownUntil: prevCooldownUntil,
        attempts: 2,
      }),
    );
  });

  // --- UC-02 LOGIN ---
  it('[UT-S-10] Đăng nhập thành công (Happy Path - Cấp JWT Token)', async () => {
    const mockUser: any = {
      id: 'u-1',
      email: 'a@famidoc.vn',
      passwordHash: hashSync('Password@123', 4),
      role: 'FAMILY_REP',
      status: 'ACTIVE',
    };
    repository.findByEmail.mockResolvedValue(mockUser);
    jwtService.sign.mockReturnValue('jwt_token_123');

    // Giả lập password match trong implementation
    const res = await service.login({
      email: 'a@famidoc.vn',
      password: 'Password@123',
    });
    expect(res.accessToken).toBe('jwt_token_123');
  });

  it('[UT-S-12] Đăng nhập thất bại do sai mật khẩu nhiều lần vẫn trả UnauthorizedException và không khóa tài khoản', async () => {
    const mockUser: any = {
      id: 'u-1',
      email: 'a@famidoc.vn',
      passwordHash: hashSync('DifferentPassword@123', 4),
      status: 'ACTIVE',
    };
    repository.findByEmail.mockResolvedValue(mockUser);

    for (let attempt = 1; attempt <= 6; attempt += 1) {
      await expect(
        service.login({ email: 'a@famidoc.vn', password: 'WrongPassword' }),
      ).rejects.toThrow(UnauthorizedException);
    }
    expect(redisService.set).not.toHaveBeenCalled();
  });

  it('[UT-S-14] Đăng nhập thất bại do Email không tồn tại trong hệ thống (GB-05)', async () => {
    redisService.get.mockResolvedValue(null);
    repository.findByEmail.mockResolvedValue(null);

    await expect(
      service.login({
        email: 'notfound@famidoc.vn',
        password: 'Password@123',
      }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('[UT-S-15] Đăng nhập bị từ chối do tài khoản bị Suspended / Deactivated', async () => {
    redisService.get.mockResolvedValue(null);
    const mockUser: any = {
      id: 'u-1',
      email: 'a@famidoc.vn',
      passwordHash: hashSync('Password@123', 4),
      status: 'SUSPENDED',
    };
    repository.findByEmail.mockResolvedValue(mockUser);

    await expect(
      service.login({ email: 'a@famidoc.vn', password: 'Password@123' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('[UT-S-16] Đăng nhập của Bác sĩ chưa được phê duyệt CCHN (Pending)', async () => {
    redisService.get.mockResolvedValue(null);
    const mockUser: any = {
      id: 'd-1',
      email: 'doctor@famidoc.vn',
      passwordHash: hashSync('Password@123', 4),
      role: 'DOCTOR',
      status: 'PENDING',
    };
    repository.findByEmail.mockResolvedValue(mockUser);
    jwtService.sign.mockReturnValue('jwt_onboarding_token');

    const res = await service.login({
      email: 'doctor@famidoc.vn',
      password: 'Password@123',
    });
    expect(res.accessToken).toBe('jwt_onboarding_token');
  });

  it('[UT-S-16b] Đăng nhập thất bại khi không cung cấp email hợp lệ (rỗng)', async () => {
    await expect(
      service.login({
        email: '',
        password: 'Password@123',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('[UT-S-16c] Đăng nhập bị từ chối nếu người dùng thông thường (không phải DOCTOR) ở trạng thái PENDING', async () => {
    redisService.get.mockResolvedValue(null);
    const mockUser: any = {
      id: 'u-pending',
      email: 'pending@famidoc.vn',
      passwordHash: hashSync('Password@123', 4),
      role: 'FAMILY_REP',
      status: 'PENDING',
    };
    repository.findByEmail.mockResolvedValue(mockUser);

    await expect(
      service.login({
        email: 'pending@famidoc.vn',
        password: 'Password@123',
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('[UT-S-16d] Đăng nhập tự động cắt bỏ khoảng trắng thừa ở email (trim)', async () => {
    redisService.get.mockResolvedValue(null);
    const mockUser: any = {
      id: 'u-trim',
      email: 'trim@famidoc.vn',
      passwordHash: hashSync('Password@123', 4),
      role: 'FAMILY_REP',
      status: 'ACTIVE',
    };
    repository.findByEmail.mockResolvedValue(mockUser);
    jwtService.sign.mockReturnValue('jwt_trim_token');

    const res = await service.login({
      email: '  trim@famidoc.vn  ',
      password: 'Password@123',
    });
    expect(repository.findByEmail).toHaveBeenCalledWith('trim@famidoc.vn');
    expect(res.accessToken).toBe('jwt_trim_token');
  });

  // --- UC-02 LOGIN: Remember Me (7 ngày vs 1 giờ) ---
  describe('Remember Me — cấp JWT theo thời hạn rememberMe', () => {
    const buildActiveUser = (): any => ({
      id: 'u-1',
      email: 'user@famidoc.vn',
      passwordHash: hashSync('Password@123', 4),
      role: 'FAMILY_REP',
      status: 'ACTIVE',
    });

    beforeEach(() => {
      redisService.get.mockResolvedValue(null);
      repository.findByEmail.mockResolvedValue(buildActiveUser());
      jwtService.sign.mockReturnValue('jwt_token_remember');
    });

    it('[UT-S-26] rememberMe = true -> ký JWT với expiresIn 7 ngày', async () => {
      await service.login({
        email: 'user@famidoc.vn',
        password: 'Password@123',
        rememberMe: true,
      });

      expect(jwtService.sign).toHaveBeenCalledWith(expect.any(Object), {
        expiresIn: '7d',
      });
    });

    it('[UT-S-27] rememberMe = false -> ký JWT với expiresIn 1 giờ', async () => {
      await service.login({
        email: 'user@famidoc.vn',
        password: 'Password@123',
        rememberMe: false,
      });

      expect(jwtService.sign).toHaveBeenCalledWith(expect.any(Object), {
        expiresIn: '1h',
      });
    });

    it('[UT-S-28] Không truyền rememberMe -> fallback session mặc định 1 giờ', async () => {
      await service.login({
        email: 'user@famidoc.vn',
        password: 'Password@123',
      });

      expect(jwtService.sign).toHaveBeenCalledWith(expect.any(Object), {
        expiresIn: '1h',
      });
    });
  });

  // --- UC-03 LOGOUT ---
  it('[UT-S-17] Đăng xuất an toàn (Logout - Đưa Token vào Redis Blacklist)', async () => {
    jwtService.decode.mockReturnValue({
      jti: 'token-uuid',
      exp: Math.floor(Date.now() / 1000) + 600,
    });
    redisService.set.mockResolvedValue('OK');

    const res = await service.logout('u-1', 'Bearer token_abc');
    expect(redisService.set).toHaveBeenCalled();
    expect(res.success).toBe(true);
  });

  it('[UT-S-17b] Đăng xuất đưa cả JTI và raw token vào Blacklist với TTL chính xác', async () => {
    const expTime = Math.floor(Date.now() / 1000) + 900;
    jwtService.decode.mockReturnValue({
      jti: 'jti-unique-123',
      exp: expTime,
    });
    redisService.set.mockResolvedValue('OK');

    const res = await service.logout('u-1', 'Bearer token_full_value');
    expect(redisService.set).toHaveBeenCalledWith(
      'blacklist:jti-unique-123',
      'revoked',
      'EX',
      expect.any(Number),
    );
    expect(redisService.set).toHaveBeenCalledWith(
      'blacklist:token_full_value',
      'revoked',
      'EX',
      expect.any(Number),
    );
    expect(res).toEqual({
      message: 'Logged out successfully',
      success: true,
    });
  });

  it('[UT-S-17c] Đăng xuất xử lý an toàn khi token rỗng', async () => {
    const res = await service.logout('u-1', '');
    expect(res).toEqual({
      message: 'Logged out successfully',
      success: true,
    });
  });

  // --- UC-04 FORGOT & RESET PASSWORD ---
  it('[UT-S-18] Quên mật khẩu: Gửi OTP reset qua Email cho tài khoản tồn tại', async () => {
    repository.findOtpChallenge.mockResolvedValue(null);
    repository.findByEmail.mockResolvedValue({
      id: 'u-1',
      email: 'a@famidoc.vn',
    } as any);
    repository.upsertOtpChallenge.mockResolvedValue({} as any);
    mailerService.sendMail.mockResolvedValue(true);

    const res = await service.forgotPassword({ email: 'a@famidoc.vn' });
    expect(res.success).toBe(true);
    expect(repository.upsertOtpChallenge).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: 'RESET_PASSWORD', email: 'a@famidoc.vn' }),
    );
    expect(mailerService.sendMail).toHaveBeenCalled();
  });

  it('[UT-S-18b] Quên mật khẩu: Bị từ chối do còn trong thời gian Cooldown (< 60s)', async () => {
    repository.findOtpChallenge.mockResolvedValue({
      id: 'ch-r1',
      purpose: 'RESET_PASSWORD',
      email: 'a@famidoc.vn',
      otpHash: 'h',
      expiresAt: new Date(Date.now() + 500_000),
      cooldownUntil: new Date(Date.now() + 45_000),
      attempts: 0,
      maxAttempts: 5,
    });

    await expect(
      service.requestForgotPassword({ email: 'a@famidoc.vn' }),
    ).rejects.toThrow(HttpException);
  });

  it('[UT-S-18c] Quên mật khẩu: requestForgotPassword tự động trim và lowercase email', async () => {
    repository.findOtpChallenge.mockResolvedValue(null);
    repository.findByEmail.mockResolvedValue({
      id: 'u-1',
      email: 'a@famidoc.vn',
    } as any);
    repository.upsertOtpChallenge.mockResolvedValue({} as any);
    mailerService.sendMail.mockResolvedValue(true);

    const res = await service.requestForgotPassword({ email: '  A@FAMIDOC.VN  ' });
    expect(repository.findByEmail).toHaveBeenCalledWith('a@famidoc.vn');
    expect(res.success).toBe(true);
  });

  it('[UT-S-19] Quên mật khẩu: Email không tồn tại trong hệ thống (Bảo mật GB-05)', async () => {
    repository.findOtpChallenge.mockResolvedValue(null);
    repository.findByEmail.mockResolvedValue(null);

    const res = await service.forgotPassword({ email: 'notfound@famidoc.vn' });
    expect(res.success).toBe(true);
    expect(mailerService.sendMail).not.toHaveBeenCalled();
  });

  it('[UT-S-20] Đặt lại mật khẩu (Reset Password) thành công bằng OTP', async () => {
    const otpHash = (service as any).hashOtp('RESET_PASSWORD', 'a@famidoc.vn', '654321');
    repository.findOtpChallenge.mockResolvedValue({
      id: 'ch-r1',
      purpose: 'RESET_PASSWORD',
      email: 'a@famidoc.vn',
      otpHash,
      expiresAt: new Date(Date.now() + 500_000),
      cooldownUntil: new Date(Date.now() + 30_000),
      attempts: 0,
      maxAttempts: 5,
    });
    repository.findByEmail.mockResolvedValue({
      id: 'u-1',
      email: 'a@famidoc.vn',
    } as any);

    const res = await service.resetPassword({
      email: 'a@famidoc.vn',
      otp: '654321',
      newPassword: 'NewPassword@123',
    });

    expect(res.success).toBe(true);
    expect(repository.updatePassword).toHaveBeenCalled();
    expect(repository.deleteOtpChallenge).toHaveBeenCalledWith(
      'RESET_PASSWORD',
      'a@famidoc.vn',
    );
    expect(redisService.set).toHaveBeenCalledWith(
      'token:revoked:u-1',
      expect.any(String),
      'EX',
      expect.any(Number),
    );
  });

  it('[UT-S-20b] Đặt lại mật khẩu thất bại do mã OTP không khớp', async () => {
    const otpHash = (service as any).hashOtp('RESET_PASSWORD', 'a@famidoc.vn', '123456');
    repository.findOtpChallenge.mockResolvedValue({
      id: 'ch-r1',
      purpose: 'RESET_PASSWORD',
      email: 'a@famidoc.vn',
      otpHash,
      expiresAt: new Date(Date.now() + 500_000),
      cooldownUntil: new Date(Date.now() + 30_000),
      attempts: 0,
      maxAttempts: 5,
    });

    await expect(
      service.resetPassword({
        email: 'a@famidoc.vn',
        otp: '999999',
        newPassword: 'NewPassword@123',
      }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('[UT-S-20c] Đặt lại mật khẩu thất bại do OTP đã hết hạn (không tồn tại trong DB)', async () => {
    repository.findOtpChallenge.mockResolvedValue(null);

    await expect(
      service.resetPassword({
        email: 'a@famidoc.vn',
        otp: '123456',
        newPassword: 'NewPassword@123',
      }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('[UT-S-20d] Đặt lại mật khẩu thất bại do email không tồn tại trong DB', async () => {
    const otpHash = (service as any).hashOtp('RESET_PASSWORD', 'notfound@famidoc.vn', '123456');
    repository.findOtpChallenge.mockResolvedValue({
      id: 'ch-r1',
      purpose: 'RESET_PASSWORD',
      email: 'notfound@famidoc.vn',
      otpHash,
      expiresAt: new Date(Date.now() + 500_000),
      cooldownUntil: new Date(Date.now() + 30_000),
      attempts: 0,
      maxAttempts: 5,
    });
    repository.findByEmail.mockResolvedValue(null);

    await expect(
      service.resetPassword({
        email: 'notfound@famidoc.vn',
        otp: '123456',
        newPassword: 'NewPassword@123',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('[UT-S-20e] Đặt lại mật khẩu tự động mở khóa brute-force và reset failed attempts khi thành công', async () => {
    const otpHash = (service as any).hashOtp('RESET_PASSWORD', 'a@famidoc.vn', '654321');
    repository.findOtpChallenge.mockResolvedValue({
      id: 'ch-r1',
      purpose: 'RESET_PASSWORD',
      email: 'a@famidoc.vn',
      otpHash,
      expiresAt: new Date(Date.now() + 500_000),
      cooldownUntil: new Date(Date.now() + 30_000),
      attempts: 0,
      maxAttempts: 5,
    });
    repository.findByEmail.mockResolvedValue({
      id: 'u-1',
      email: 'a@famidoc.vn',
      phone: '0912345678',
      failedLoginAttempts: 3,
    } as any);

    const res = await service.resetPassword({
      email: '  A@FAMIDOC.VN  ',
      otp: '654321',
      newPassword: 'NewPassword@123',
    });

    expect(res.success).toBe(true);
  });

  // --- UC-05 CHANGE PASSWORD ---
  it('[UT-S-21] Đổi mật khẩu (Change Password) thành công khi nhập đúng mật khẩu cũ', async () => {
    repository.findById.mockResolvedValue({
      id: 'u-1',
      passwordHash: hashSync('OldPassword@123', 4),
    } as any);

    const res = await service.changePassword('u-1', {
      oldPassword: 'OldPassword@123',
      newPassword: 'NewPassword@123',
    });
    expect(res.success).toBe(true);
    expect(repository.updatePassword).toHaveBeenCalled();
    expect(redisService.set).toHaveBeenCalledWith(
      'token:revoked:u-1',
      expect.any(String),
      'EX',
      expect.any(Number),
    );
  });

  it('[UT-S-22] Đổi mật khẩu thất bại do nhập sai mật khẩu cũ', async () => {
    repository.findById.mockResolvedValue({
      id: 'u-1',
      passwordHash: hashSync('DifferentPassword@123', 4),
    } as any);

    await expect(
      service.changePassword('u-1', {
        oldPassword: 'WrongOldPassword',
        newPassword: 'NewPassword@123',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('[UT-S-23] Đổi mật khẩu thất bại do mật khẩu mới trùng với mật khẩu cũ', async () => {
    repository.findById.mockResolvedValue({
      id: 'u-1',
      passwordHash: 'same_hash',
    } as any);

    await expect(
      service.changePassword('u-1', {
        oldPassword: 'SamePassword@123',
        newPassword: 'SamePassword@123',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('[UT-S-24] Đổi mật khẩu thất bại do không tìm thấy user theo userId', async () => {
    repository.findById.mockResolvedValue(null);

    await expect(
      service.changePassword('u-notfound', {
        oldPassword: 'OldPassword@123',
        newPassword: 'NewPassword@123',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('[UT-S-25] Đổi mật khẩu tự động dọn dẹp các khóa đăng nhập và reset failed attempts khi thành công', async () => {
    repository.findById.mockResolvedValue({
      id: 'u-1',
      email: 'a@famidoc.vn',
      phone: '0912345678',
      passwordHash: hashSync('OldPassword@123', 4),
      failedLoginAttempts: 2,
    } as any);

    const res = await service.changePassword('u-1', {
      oldPassword: 'OldPassword@123',
      newPassword: 'NewPassword@456',
    });

    expect(res.success).toBe(true);
  });

  // --- FAULT INJECTION TESTS ---
  it('[FI-01] Prisma error P2002 chuyển đổi thành ConflictException', async () => {
    repository.findByEmail.mockRejectedValue({ code: 'P2002' });

    await expect(
      service.registerFamilyRepresentative({
        fullName: 'Nguyen Van A',
        phone: '0912345678',
        email: 'a@famidoc.vn',
        password: 'Password@123',
        acceptTerms: true,
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('[FI-02] Mất kết nối DB ném ServiceUnavailableException', async () => {
    repository.findByEmail.mockRejectedValue(new Error('Connection lost'));

    await expect(
      service.registerFamilyRepresentative({
        fullName: 'Nguyen Van A',
        phone: '0912345678',
        email: 'a@famidoc.vn',
        password: 'Password@123',
        acceptTerms: true,
      }),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it('[FI-03] Lỗi kết nối DB khi đăng nhập ném ServiceUnavailableException', async () => {
    repository.findByEmail.mockRejectedValue(new Error('DB connection failed'));

    await expect(
      service.login({ email: 'a@famidoc.vn', password: 'Password@123' }),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it('[FI-04] Mailer timeout ném ServiceUnavailableException và dọn challenge tạm', async () => {
    repository.findByEmail.mockResolvedValue(null);
    repository.findByPhone.mockResolvedValue(null);
    repository.findOtpChallenge.mockResolvedValue(null);
    repository.upsertOtpChallenge.mockResolvedValue({} as any);
    repository.deleteOtpChallenge.mockResolvedValue(undefined);
    mailerService.sendMail.mockRejectedValue(new Error('SMTP timeout'));

    await expect(
      service.registerFamilyRepresentative({
        fullName: 'Nguyen Van A',
        phone: '0912345678',
        email: 'a@famidoc.vn',
        password: 'Password@123',
        acceptTerms: true,
      }),
    ).rejects.toThrow(ServiceUnavailableException);
    expect(repository.deleteOtpChallenge).toHaveBeenCalledWith(
      'REGISTER_FAMILY_REP',
      'a@famidoc.vn',
    );
  });

  it('[FI-05] Hasher gặp sự cố ném InternalServerErrorException', async () => {
    repository.findById.mockResolvedValue({
      id: 'u-1',
      passwordHash: hashSync('Password@123', 4),
    } as any);
    // giả lập lỗi crash bộ nhớ
    jest
      .spyOn(service as any, 'verifyPassword' as any)
      .mockRejectedValue(new Error('Memory allocation failed'));

    await expect(
      service.changePassword('u-1', {
        oldPassword: 'OldPassword@123',
        newPassword: 'NewPassword@123',
      }),
    ).rejects.toThrow(InternalServerErrorException);
  });

  describe('Password Hashing & Verification (bcryptjs)', () => {
    it('băm mật khẩu và so khớp thành công với mật khẩu đúng', async () => {
      const plain = 'StrongPass@123';
      const hash = await (service as any).hashPassword(plain);
      expect(hash).toBeDefined();
      expect(hash).not.toBe(plain);
      expect(hash.startsWith('$2a$') || hash.startsWith('$2b$')).toBe(true);

      const isValid = await (service as any).verifyPassword(plain, hash);
      expect(isValid).toBe(true);
    });

    it('so khớp thất bại với mật khẩu sai', async () => {
      const hash = await (service as any).hashPassword('CorrectPass@123');
      const isValid = await (service as any).verifyPassword(
        'WrongPass@123',
        hash,
      );
      expect(isValid).toBe(false);
    });
  });

  describe('Refresh Token Rotation (PostgreSQL)', () => {
    it('login issues refreshToken and stores hashed session in PostgreSQL', async () => {
      const passwordHash = hashSync('Secret@123', 4);
      repository.findByEmail.mockResolvedValue({
        id: 'user-1',
        email: 'rep@famidoc.vn',
        phone: '0912345678',
        fullName: 'Rep',
        passwordHash,
        role: 'FAMILY_REP',
        status: 'ACTIVE',
      } as any);
      jwtService.sign.mockReturnValue('access-jwt');

      const res: any = await service.login({
        email: 'rep@famidoc.vn',
        password: 'Secret@123',
        rememberMe: false,
      });

      expect(res.accessToken).toBe('access-jwt');
      expect(typeof res.refreshToken).toBe('string');
      expect(res.refreshToken.length).toBeGreaterThan(20);
      expect(res.expiresInSeconds).toBe(3600);
      expect(repository.createAuthSession).toHaveBeenCalledTimes(1);
    });

    it('refresh rotates refreshToken in PostgreSQL and returns new token pair', async () => {
      repository.findAuthSessionByTokenHash.mockResolvedValue({
        id: 'sess-1',
        userId: 'user-1',
        tokenHash: 'old-hash',
        familyId: 'fam-1',
        rememberMe: false,
        expiresAt: new Date(Date.now() + 3600_000),
        revokedAt: null,
        createdAt: new Date(),
      });
      repository.findById.mockResolvedValue({
        id: 'user-1',
        email: 'rep@famidoc.vn',
        phone: '0912345678',
        fullName: 'Rep',
        role: 'FAMILY_REP',
        status: 'ACTIVE',
      } as any);
      repository.rotateAuthSession.mockResolvedValue({
        rotated: true,
        session: {
          id: 'sess-2',
          userId: 'user-1',
          tokenHash: 'new-hash',
          familyId: 'fam-1',
          rememberMe: false,
          expiresAt: new Date(Date.now() + 86400_000),
          createdAt: new Date(),
        },
      });
      jwtService.sign.mockReturnValue('new-access-jwt');

      const res = await (service as any).refresh({ refreshToken: 'raw-refresh-token' });
      expect(res.accessToken).toBe('new-access-jwt');
      expect(typeof res.refreshToken).toBe('string');
      expect(res.refreshToken).not.toBe('raw-refresh-token');
    });

    it('refresh rejects revoked or reused token', async () => {
      repository.findAuthSessionByTokenHash.mockResolvedValue({
        id: 'sess-1',
        userId: 'user-1',
        tokenHash: 'old-hash',
        familyId: 'fam-1',
        rememberMe: false,
        expiresAt: new Date(Date.now() + 3600_000),
        revokedAt: new Date(),
        createdAt: new Date(),
      });

      await expect(
        (service as any).refresh({ refreshToken: 'reused-token' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
