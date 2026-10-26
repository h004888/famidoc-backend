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
      updatePassword: jest.fn(),
      incrementTokenVersion: jest.fn(),
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
  it('[UT-S-01] Khởi tạo đăng ký Family Rep thành công (gửi OTP qua Email)', async () => {
    repository.findByEmail.mockResolvedValue(null);
    repository.findByPhone.mockResolvedValue(null);
    redisService.ttl.mockResolvedValue(-2);
    redisService.set.mockResolvedValue('OK');
    mailerService.sendMail.mockResolvedValue(true);

    const res = await service.registerFamilyRep({
      fullName: 'Nguyen Van A',
      phone: '0912345678',
      email: 'a@famidoc.vn',
      password: 'Password@123',
      acceptedTerms: true,
    });

    expect(res.expiresInSeconds).toBe(300);
    expect(redisService.set).toHaveBeenCalled();
    expect(mailerService.sendMail).toHaveBeenCalled();
  });

  it('[UT-S-02] Từ chối đăng ký do Email đã tồn tại', async () => {
    repository.findByEmail.mockResolvedValue({ id: '1' } as any);

    await expect(
      service.registerFamilyRep({
        fullName: 'Nguyen Van A',
        phone: '0912345678',
        email: 'a@famidoc.vn',
        password: 'Password@123',
        acceptedTerms: true,
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('[UT-S-03] Từ chối đăng ký do Số điện thoại đã tồn tại', async () => {
    repository.findByEmail.mockResolvedValue(null);
    repository.findByPhone.mockResolvedValue({ id: '1' } as any);

    await expect(
      service.registerFamilyRep({
        fullName: 'Nguyen Van A',
        phone: '0912345678',
        email: 'a@famidoc.vn',
        password: 'Password@123',
        acceptedTerms: true,
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('[UT-S-04] Từ chối đăng ký do chưa tích chọn cam kết Điều khoản / NĐ13', async () => {
    await expect(
      service.registerFamilyRep({
        fullName: 'Nguyen Van A',
        phone: '0912345678',
        email: 'a@famidoc.vn',
        password: 'Password@123',
        acceptedTerms: false,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('[UT-S-05] Xác thực Email OTP đăng ký thành công (Khởi tạo tài khoản)', async () => {
    const cachedData = JSON.stringify({
      fullName: 'Nguyen Van A',
      phone: '0912345678',
      password: 'Password@123',
      otp: '123456',
    });
    redisService.get.mockResolvedValue(cachedData);
    repository.createFamilyRepWithProfile.mockResolvedValue({
      id: 'u-1',
      email: 'a@famidoc.vn',
      role: 'FAMILY_REP',
      status: 'ACTIVE',
    } as any);

    const user = await service.verifyEmailOtp({ email: 'a@famidoc.vn', otp: '123456' });
    expect(user.id).toBe('u-1');
    expect(redisService.del).toHaveBeenCalled();
    expect(repository.createFamilyRepWithProfile).toHaveBeenCalled();
  });

  it('[UT-S-06] Xác thực Email OTP thất bại do mã OTP sai', async () => {
    const cachedData = JSON.stringify({
      fullName: 'Nguyen Van A',
      phone: '0912345678',
      password: 'Password@123',
      otp: '123456',
    });
    redisService.get.mockResolvedValue(cachedData);

    await expect(
      service.verifyEmailOtp({ email: 'a@famidoc.vn', otp: '999999' }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('[UT-S-07] Xác thực Email OTP thất bại do OTP hết hạn (Key không tồn tại trong Redis)', async () => {
    redisService.get.mockResolvedValue(null);

    await expect(
      service.verifyEmailOtp({ email: 'a@famidoc.vn', otp: '123456' }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('[UT-S-08] Gửi lại OTP bị từ chối do còn trong thời gian Cooldown (< 60s)', async () => {
    redisService.ttl.mockResolvedValue(45);

    await expect(service.resendEmailOtp({ email: 'a@famidoc.vn' })).rejects.toThrow(
      HttpException,
    );
  });

  it('[UT-S-09] Gửi lại OTP thành công khi hết thời gian Cooldown (> 60s)', async () => {
    redisService.ttl.mockResolvedValue(-2);
    redisService.get.mockResolvedValue(JSON.stringify({ fullName: 'A', phone: '09', password: 'P' }));
    redisService.set.mockResolvedValue('OK');
    mailerService.sendMail.mockResolvedValue(true);

    const res = await service.resendEmailOtp({ email: 'a@famidoc.vn' });
    expect(res.success).toBe(true);
    expect(mailerService.sendMail).toHaveBeenCalled();
  });

  // --- UC-02 LOGIN ---
  it('[UT-S-10] Đăng nhập thành công (Happy Path - Cấp JWT Token)', async () => {
    redisService.get.mockResolvedValue(null); // not locked
    const mockUser: any = {
      id: 'u-1',
      email: 'a@famidoc.vn',
      passwordHash: 'hash',
      role: 'FAMILY_REP',
      status: 'ACTIVE',
      tokenVersion: 1,
    };
    repository.findByEmail.mockResolvedValue(mockUser);
    jwtService.sign.mockReturnValue('jwt_token_123');

    // Giả lập password match trong implementation
    const res = await service.login({ identifier: 'a@famidoc.vn', password: 'Password@123' });
    expect(res.accessToken).toBe('jwt_token_123');
    expect(redisService.del).toHaveBeenCalledWith('login:fail:a@famidoc.vn');
  });

  it('[UT-S-11] Đăng nhập thất bại do tài khoản đang bị khóa Brute-force', async () => {
    redisService.get.mockImplementation((key: string) => {
      if (key.includes('login:lock:')) return Promise.resolve('1');
      return Promise.resolve(null);
    });

    await expect(
      service.login({ identifier: 'a@famidoc.vn', password: 'Any' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('[UT-S-12] Đăng nhập thất bại do sai mật khẩu lần thứ 1 đến 4', async () => {
    redisService.get.mockResolvedValue(null);
    const mockUser: any = {
      id: 'u-1',
      email: 'a@famidoc.vn',
      passwordHash: 'different_hash',
      status: 'ACTIVE',
    };
    repository.findByEmail.mockResolvedValue(mockUser);
    redisService.incr.mockResolvedValue(3);

    await expect(
      service.login({ identifier: 'a@famidoc.vn', password: 'WrongPassword' }),
    ).rejects.toThrow(UnauthorizedException);
    expect(redisService.incr).toHaveBeenCalled();
  });

  it('[UT-S-13] Đăng nhập sai mật khẩu lần thứ 5 -> Kích hoạt khóa tài khoản 30 phút', async () => {
    redisService.get.mockResolvedValue(null);
    const mockUser: any = {
      id: 'u-1',
      email: 'a@famidoc.vn',
      passwordHash: 'different_hash',
      status: 'ACTIVE',
    };
    repository.findByEmail.mockResolvedValue(mockUser);
    redisService.incr.mockResolvedValue(5);

    await expect(
      service.login({ identifier: 'a@famidoc.vn', password: 'WrongPassword' }),
    ).rejects.toThrow(UnauthorizedException);
    expect(redisService.set).toHaveBeenCalledWith(
      'login:lock:a@famidoc.vn',
      '1',
      'EX',
      1800,
    );
  });

  it('[UT-S-14] Đăng nhập thất bại do Email không tồn tại trong hệ thống (GB-05)', async () => {
    redisService.get.mockResolvedValue(null);
    repository.findByEmail.mockResolvedValue(null);
    repository.findByPhone.mockResolvedValue(null);

    await expect(
      service.login({ identifier: 'notfound@famidoc.vn', password: 'Password@123' }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('[UT-S-15] Đăng nhập bị từ chối do tài khoản bị Suspended / Deactivated', async () => {
    redisService.get.mockResolvedValue(null);
    const mockUser: any = {
      id: 'u-1',
      email: 'a@famidoc.vn',
      passwordHash: 'hash',
      status: 'SUSPENDED',
    };
    repository.findByEmail.mockResolvedValue(mockUser);

    await expect(
      service.login({ identifier: 'a@famidoc.vn', password: 'Password@123' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('[UT-S-16] Đăng nhập của Bác sĩ chưa được phê duyệt CCHN (Pending)', async () => {
    redisService.get.mockResolvedValue(null);
    const mockUser: any = {
      id: 'd-1',
      email: 'doctor@famidoc.vn',
      passwordHash: 'hash',
      role: 'DOCTOR',
      status: 'PENDING_VERIFICATION',
      tokenVersion: 1,
    };
    repository.findByEmail.mockResolvedValue(mockUser);
    jwtService.sign.mockReturnValue('jwt_onboarding_token');

    const res = await service.login({
      identifier: 'doctor@famidoc.vn',
      password: 'Password@123',
    });
    expect(res.accessToken).toBe('jwt_onboarding_token');
  });

  // --- UC-03 LOGOUT ---
  it('[UT-S-17] Đăng xuất an toàn (Logout - Đưa Token vào Redis Blacklist)', async () => {
    jwtService.decode.mockReturnValue({ jti: 'token-uuid', exp: Math.floor(Date.now() / 1000) + 600 });
    redisService.set.mockResolvedValue('OK');

    await service.logout('u-1', 'Bearer token_abc');
    expect(redisService.set).toHaveBeenCalled();
  });

  // --- UC-04 FORGOT & RESET PASSWORD ---
  it('[UT-S-18] Quên mật khẩu: Gửi OTP reset qua Email cho tài khoản tồn tại', async () => {
    repository.findByEmail.mockResolvedValue({ id: 'u-1', email: 'a@famidoc.vn' } as any);
    redisService.set.mockResolvedValue('OK');
    mailerService.sendMail.mockResolvedValue(true);

    const res = await service.forgotPassword({ email: 'a@famidoc.vn' });
    expect(res.success).toBe(true);
    expect(mailerService.sendMail).toHaveBeenCalled();
  });

  it('[UT-S-19] Quên mật khẩu: Email không tồn tại trong hệ thống (Bảo mật GB-05)', async () => {
    repository.findByEmail.mockResolvedValue(null);

    const res = await service.forgotPassword({ email: 'notfound@famidoc.vn' });
    expect(res.success).toBe(true);
    expect(mailerService.sendMail).not.toHaveBeenCalled();
  });

  it('[UT-S-20] Đặt lại mật khẩu (Reset Password) thành công bằng OTP', async () => {
    redisService.get.mockResolvedValue('654321');
    repository.findByEmail.mockResolvedValue({ id: 'u-1', email: 'a@famidoc.vn' } as any);

    const res = await service.resetPassword({
      email: 'a@famidoc.vn',
      otp: '654321',
      newPassword: 'NewPassword@123',
    });

    expect(res.success).toBe(true);
    expect(repository.updatePassword).toHaveBeenCalled();
    expect(repository.incrementTokenVersion).toHaveBeenCalledWith('u-1');
    expect(redisService.del).toHaveBeenCalled();
  });

  // --- UC-05 CHANGE PASSWORD ---
  it('[UT-S-21] Đổi mật khẩu (Change Password) thành công khi nhập đúng mật khẩu cũ', async () => {
    repository.findById.mockResolvedValue({
      id: 'u-1',
      passwordHash: 'hash',
    } as any);

    const res = await service.changePassword('u-1', {
      oldPassword: 'OldPassword@123',
      newPassword: 'NewPassword@123',
    });
    expect(res.success).toBe(true);
    expect(repository.updatePassword).toHaveBeenCalled();
    expect(repository.incrementTokenVersion).toHaveBeenCalledWith('u-1');
  });

  it('[UT-S-22] Đổi mật khẩu thất bại do nhập sai mật khẩu cũ', async () => {
    repository.findById.mockResolvedValue({
      id: 'u-1',
      passwordHash: 'different_hash',
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

  // --- FAULT INJECTION TESTS ---
  it('[FI-01] Prisma error P2002 chuyển đổi thành ConflictException', async () => {
    repository.findByEmail.mockRejectedValue({ code: 'P2002' });

    await expect(
      service.registerFamilyRep({
        fullName: 'Nguyen Van A',
        phone: '0912345678',
        email: 'a@famidoc.vn',
        password: 'Password@123',
        acceptedTerms: true,
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('[FI-02] Mất kết nối DB ném ServiceUnavailableException', async () => {
    repository.findByEmail.mockRejectedValue(new Error('Connection lost'));

    await expect(
      service.registerFamilyRep({
        fullName: 'Nguyen Van A',
        phone: '0912345678',
        email: 'a@famidoc.vn',
        password: 'Password@123',
        acceptedTerms: true,
      }),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it('[FI-03] Redis gặp sự cố ném ServiceUnavailableException', async () => {
    redisService.get.mockRejectedValue(new Error('Redis connection failed'));

    await expect(
      service.login({ identifier: 'a@famidoc.vn', password: 'Password@123' }),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it('[FI-04] Mailer timeout ném ServiceUnavailableException', async () => {
    repository.findByEmail.mockResolvedValue(null);
    repository.findByPhone.mockResolvedValue(null);
    redisService.ttl.mockResolvedValue(-2);
    mailerService.sendMail.mockRejectedValue(new Error('SMTP timeout'));

    await expect(
      service.registerFamilyRep({
        fullName: 'Nguyen Van A',
        phone: '0912345678',
        email: 'a@famidoc.vn',
        password: 'Password@123',
        acceptedTerms: true,
      }),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it('[FI-05] Hasher gặp sự cố ném InternalServerErrorException', async () => {
    repository.findById.mockResolvedValue({ id: 'u-1', passwordHash: 'hash' } as any);
    // giả lập lỗi crash bộ nhớ
    jest.spyOn(service as any, 'verifyPassword' as any).mockRejectedValue(new Error('Memory allocation failed'));

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
      const isValid = await (service as any).verifyPassword('WrongPass@123', hash);
      expect(isValid).toBe(false);
    });
  });
});
