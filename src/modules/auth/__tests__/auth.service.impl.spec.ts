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
      updatePassword: jest.fn(),
      updateFailedAttempts: jest.fn(),
      resetFailedAttempts: jest.fn(),
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
    expect(redisService.set).toHaveBeenCalled();
    expect(mailerService.sendMail).toHaveBeenCalled();
  });

  it('[UT-S-01b] registerFamilyRepresentative lưu thông tin OTP an toàn vào Redis', async () => {
    repository.findByEmail.mockResolvedValue(null);
    repository.findByPhone.mockResolvedValue(null);
    redisService.ttl.mockResolvedValue(-2);
    redisService.set.mockResolvedValue('OK');
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
    const registrationCall = redisService.set.mock.calls.find(
      ([key]: [string]) => key === 'otp:reg:rep@famidoc.vn',
    );
    const registration = JSON.parse(registrationCall[1]);
    expect(registration.fullName).toBe('Nguyen Van A');
    expect(registration.password).toBeUndefined();
    expect(compareSync('Password@123', registration.passwordHash)).toBe(true);
    expect(mailerService.sendMail).toHaveBeenCalled();
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

  it('[UT-S-05] Xác thực Email OTP đăng ký thành công (Khởi tạo tài khoản)', async () => {
    const cachedData = JSON.stringify({
      fullName: 'Nguyen Van A',
      phone: '0912345678',
      passwordHash: hashSync('Password@123', 4),
      homeAddress: 'Số 10 Phố Huế, Hà Nội',
      otp: '123456',
    });
    redisService.get.mockResolvedValue(cachedData);
    repository.createFamilyRepWithProfile.mockResolvedValue({
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
    expect(redisService.del).toHaveBeenCalled();
    expect(repository.createFamilyRepWithProfile).toHaveBeenCalledWith(
      expect.objectContaining({ homeAddress: 'Số 10 Phố Huế, Hà Nội' }),
    );
  });

  it('[UT-S-06] Xác thực Email OTP thất bại do mã OTP sai', async () => {
    const cachedData = JSON.stringify({
      fullName: 'Nguyen Van A',
      phone: '0912345678',
      passwordHash: hashSync('Password@123', 4),
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

    await expect(
      service.resendEmailOtp({ email: 'a@famidoc.vn' }),
    ).rejects.toThrow(HttpException);
  });

  it('[UT-S-09] Gửi lại OTP thành công khi hết thời gian Cooldown (> 60s)', async () => {
    redisService.ttl.mockResolvedValue(-2);
    redisService.get.mockResolvedValue(
      JSON.stringify({ fullName: 'A', phone: '09', password: 'P' }),
    );
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
    expect(redisService.del).toHaveBeenCalledWith('login:fail:a@famidoc.vn');
  });

  it('[UT-S-10b] Đăng nhập thành công khi user có failedLoginAttempts > 0 -> Gọi repository.resetFailedAttempts', async () => {
    redisService.get.mockResolvedValue(null);
    const mockUser: any = {
      id: 'u-1',
      email: 'a@famidoc.vn',
      passwordHash: hashSync('Password@123', 4),
      role: 'FAMILY_REP',
      status: 'ACTIVE',
      failedLoginAttempts: 2,
    };
    repository.findByEmail.mockResolvedValue(mockUser);
    jwtService.sign.mockReturnValue('jwt_token_123');

    await service.login({ email: 'a@famidoc.vn', password: 'Password@123' });
    expect(repository.resetFailedAttempts).toHaveBeenCalledWith('u-1');
  });

  it('[UT-S-11] Đăng nhập thất bại do tài khoản đang bị khóa Brute-force', async () => {
    redisService.get.mockImplementation((key: string) => {
      if (key.includes('login:lock:')) return Promise.resolve('1');
      return Promise.resolve(null);
    });

    await expect(
      service.login({ email: 'a@famidoc.vn', password: 'Any' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('[UT-S-11b] Đăng nhập thất bại do tài khoản bị khóa -> Thông báo chuẩn 30 minutes và kiểm tra lockedUntil từ DB', async () => {
    redisService.get.mockImplementation((key: string) => {
      if (key.includes('login:lock:')) return Promise.resolve('1');
      return Promise.resolve(null);
    });

    await expect(
      service.login({ email: 'a@famidoc.vn', password: 'Any' }),
    ).rejects.toThrow('Account temporarily locked. Please try again in 30 minutes');

    // Trường hợp Redis không còn key nhưng DB có lockedUntil còn hiệu lực
    redisService.get.mockResolvedValue(null);
    const lockedUser: any = {
      id: 'u-1',
      email: 'a@famidoc.vn',
      passwordHash: 'hash',
      status: 'ACTIVE',
      lockedUntil: new Date(Date.now() + 1000 * 60 * 15), // còn 15 phút
    };
    repository.findByEmail.mockResolvedValue(lockedUser);

    await expect(
      service.login({ email: 'a@famidoc.vn', password: 'Any' }),
    ).rejects.toThrow('Account temporarily locked. Please try again in 30 minutes');
  });

  it('[UT-S-12] Đăng nhập thất bại do sai mật khẩu lần thứ 1 đến 4', async () => {
    redisService.get.mockResolvedValue(null);
    const mockUser: any = {
      id: 'u-1',
      email: 'a@famidoc.vn',
      passwordHash: hashSync('DifferentPassword@123', 4),
      status: 'ACTIVE',
    };
    repository.findByEmail.mockResolvedValue(mockUser);
    redisService.incr.mockResolvedValue(3);

    await expect(
      service.login({ email: 'a@famidoc.vn', password: 'WrongPassword' }),
    ).rejects.toThrow(UnauthorizedException);
    expect(redisService.incr).toHaveBeenCalled();
  });

  it('[UT-S-12b] Đăng nhập sai mật khẩu lần 1 đến 4 -> Đồng bộ số lần sai xuống DB với lockedUntil là null', async () => {
    redisService.get.mockResolvedValue(null);
    const mockUser: any = {
      id: 'u-1',
      email: 'a@famidoc.vn',
      passwordHash: 'different_hash',
      status: 'ACTIVE',
    };
    repository.findByEmail.mockResolvedValue(mockUser);
    redisService.incr.mockResolvedValue(2);

    await expect(
      service.login({ email: 'a@famidoc.vn', password: 'WrongPassword' }),
    ).rejects.toThrow(UnauthorizedException);
    expect(repository.updateFailedAttempts).toHaveBeenCalledWith('u-1', 2, null);
  });

  it('[UT-S-13] Đăng nhập sai mật khẩu lần thứ 5 -> Kích hoạt khóa tài khoản 30 phút', async () => {
    redisService.get.mockResolvedValue(null);
    const mockUser: any = {
      id: 'u-1',
      email: 'a@famidoc.vn',
      passwordHash: hashSync('DifferentPassword@123', 4),
      status: 'ACTIVE',
    };
    repository.findByEmail.mockResolvedValue(mockUser);
    redisService.incr.mockResolvedValue(5);

    await expect(
      service.login({ email: 'a@famidoc.vn', password: 'WrongPassword' }),
    ).rejects.toThrow(UnauthorizedException);
    expect(redisService.set).toHaveBeenCalledWith(
      'login:lock:a@famidoc.vn',
      '1',
      'EX',
      1800,
    );
  });

  it('[UT-S-13b] Đăng nhập sai mật khẩu lần thứ 5 -> Đồng bộ lockedUntil 30 phút xuống DB', async () => {
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
      service.login({ email: 'a@famidoc.vn', password: 'WrongPassword' }),
    ).rejects.toThrow(UnauthorizedException);
    expect(repository.updateFailedAttempts).toHaveBeenCalledWith(
      'u-1',
      5,
      expect.any(Date),
    );
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
    repository.findByEmail.mockResolvedValue({
      id: 'u-1',
      email: 'a@famidoc.vn',
    } as any);
    redisService.set.mockResolvedValue('OK');
    mailerService.sendMail.mockResolvedValue(true);

    const res = await service.forgotPassword({ email: 'a@famidoc.vn' });
    expect(res.success).toBe(true);
    expect(mailerService.sendMail).toHaveBeenCalled();
  });

  it('[UT-S-18b] Quên mật khẩu: Bị từ chối do còn trong thời gian Cooldown (< 60s)', async () => {
    redisService.ttl.mockResolvedValue(45);

    await expect(
      service.requestForgotPassword({ email: 'a@famidoc.vn' }),
    ).rejects.toThrow(HttpException);
  });

  it('[UT-S-18c] Quên mật khẩu: requestForgotPassword tự động trim và lowercase email', async () => {
    redisService.ttl.mockResolvedValue(-2);
    repository.findByEmail.mockResolvedValue({
      id: 'u-1',
      email: 'a@famidoc.vn',
    } as any);
    redisService.set.mockResolvedValue('OK');
    mailerService.sendMail.mockResolvedValue(true);

    const res = await service.requestForgotPassword({ email: '  A@FAMIDOC.VN  ' });
    expect(repository.findByEmail).toHaveBeenCalledWith('a@famidoc.vn');
    expect(res.success).toBe(true);
  });

  it('[UT-S-19] Quên mật khẩu: Email không tồn tại trong hệ thống (Bảo mật GB-05)', async () => {
    repository.findByEmail.mockResolvedValue(null);

    const res = await service.forgotPassword({ email: 'notfound@famidoc.vn' });
    expect(res.success).toBe(true);
    expect(mailerService.sendMail).not.toHaveBeenCalled();
  });

  it('[UT-S-20] Đặt lại mật khẩu (Reset Password) thành công bằng OTP', async () => {
    redisService.get.mockResolvedValue('654321');
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
    expect(redisService.set).toHaveBeenCalledWith(
      'token:revoked:u-1',
      expect.any(String),
      'EX',
      expect.any(Number),
    );
    expect(redisService.del).toHaveBeenCalled();
  });

  it('[UT-S-20b] Đặt lại mật khẩu thất bại do mã OTP không khớp', async () => {
    redisService.get.mockResolvedValue('123456');

    await expect(
      service.resetPassword({
        email: 'a@famidoc.vn',
        otp: '999999',
        newPassword: 'NewPassword@123',
      }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('[UT-S-20c] Đặt lại mật khẩu thất bại do OTP đã hết hạn (không tồn tại trong Redis)', async () => {
    redisService.get.mockResolvedValue(null);

    await expect(
      service.resetPassword({
        email: 'a@famidoc.vn',
        otp: '123456',
        newPassword: 'NewPassword@123',
      }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('[UT-S-20d] Đặt lại mật khẩu thất bại do email không tồn tại trong DB', async () => {
    redisService.get.mockResolvedValue('123456');
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
    redisService.get.mockResolvedValue('654321');
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
    expect(repository.resetFailedAttempts).toHaveBeenCalledWith('u-1');
    expect(redisService.del).toHaveBeenCalledWith('login:lock:a@famidoc.vn');
    expect(redisService.del).toHaveBeenCalledWith('login:fail:a@famidoc.vn');
    expect(redisService.del).toHaveBeenCalledWith('login:lock:0912345678');
    expect(redisService.del).toHaveBeenCalledWith('login:fail:0912345678');
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
    expect(repository.resetFailedAttempts).toHaveBeenCalledWith('u-1');
    expect(redisService.del).toHaveBeenCalledWith('login:lock:a@famidoc.vn');
    expect(redisService.del).toHaveBeenCalledWith('login:fail:a@famidoc.vn');
    expect(redisService.del).toHaveBeenCalledWith('login:lock:0912345678');
    expect(redisService.del).toHaveBeenCalledWith('login:fail:0912345678');
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

  it('[FI-03] Redis gặp sự cố ném ServiceUnavailableException', async () => {
    redisService.get.mockRejectedValue(new Error('Redis connection failed'));

    await expect(
      service.login({ email: 'a@famidoc.vn', password: 'Password@123' }),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it('[FI-04] Mailer timeout ném ServiceUnavailableException', async () => {
    repository.findByEmail.mockResolvedValue(null);
    repository.findByPhone.mockResolvedValue(null);
    redisService.ttl.mockResolvedValue(-2);
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

  it('[UT-S-24] Toàn vẹn chuỗi vòng đời khóa tài khoản: Sai 4 lần (chưa lock) -> Sai lần 5 (lock 30 phút trên cả Redis & DB) -> Đúng mật khẩu (reset fail về 0 trên DB)', async () => {
    const mockUser: any = {
      id: 'u-1',
      email: 'a@famidoc.vn',
      passwordHash: hashSync('Password@123', 4),
      role: 'FAMILY_REP',
      status: 'ACTIVE',
      failedLoginAttempts: 0,
      lockedUntil: null,
    };
    repository.findByEmail.mockResolvedValue(mockUser);
    jwtService.sign.mockReturnValue('jwt_token_valid');

    // 1. Sai lần 4
    redisService.get.mockResolvedValue(null);
    redisService.incr.mockResolvedValueOnce(4);
    await expect(
      service.login({ email: 'a@famidoc.vn', password: 'WrongPassword' }),
    ).rejects.toThrow(UnauthorizedException);
    expect(repository.updateFailedAttempts).toHaveBeenCalledWith('u-1', 4, null);
    expect(redisService.set).not.toHaveBeenCalledWith('login:lock:a@famidoc.vn', expect.anything(), expect.anything(), expect.anything());

    // 2. Sai lần 5 -> Lock 30 phút cả Redis & DB
    redisService.incr.mockResolvedValueOnce(5);
    await expect(
      service.login({ email: 'a@famidoc.vn', password: 'WrongPassword' }),
    ).rejects.toThrow(UnauthorizedException);
    expect(repository.updateFailedAttempts).toHaveBeenCalledWith('u-1', 5, expect.any(Date));
    expect(redisService.set).toHaveBeenCalledWith('login:lock:a@famidoc.vn', '1', 'EX', 1800);

    // 3. Đăng nhập thành công khi hết hạn lock -> Reset DB failedAttempts về 0
    mockUser.failedLoginAttempts = 5;
    mockUser.lockedUntil = null;
    redisService.get.mockResolvedValue(null);
    const successRes = await service.login({ email: 'a@famidoc.vn', password: 'Password@123' });
    expect(successRes.accessToken).toBe('jwt_token_valid');
    expect(repository.resetFailedAttempts).toHaveBeenCalledWith('u-1');
  });
});
