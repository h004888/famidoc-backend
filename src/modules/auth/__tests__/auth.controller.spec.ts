import { JwtAuthGuard } from '../../../core/auth/jwt-auth.guard';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from '../controllers/auth.controller';
import {
  AUTH_SERVICE_TOKEN,
  IAuthService,
} from '../services/interfaces/auth.service.interface';

describe('AuthController', () => {
  let controller: AuthController;
  let service: jest.Mocked<IAuthService>;

  beforeEach(async () => {
    service = {
      findAll: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
      registerFamilyRep: jest.fn(),
      verifyEmailOtp: jest.fn(),
      resendEmailOtp: jest.fn(),
      login: jest.fn(),
      logout: jest.fn(),
      forgotPassword: jest.fn(),
      resetPassword: jest.fn(),
      changePassword: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AUTH_SERVICE_TOKEN,
          useValue: service,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('được khởi tạo thành công', () => {
    expect(controller).toBeDefined();
  });

  it('[UT-C-01] registerFamilyRep ủy quyền gọi service.registerFamilyRep', async () => {
    const dto = {
      fullName: 'Nguyen Van A',
      phone: '0912345678',
      email: 'a@famidoc.vn',
      password: 'Password@123',
      acceptedTerms: true,
    };
    service.registerFamilyRep.mockResolvedValue({
      message: 'OTP sent',
      email: dto.email,
      expiresInSeconds: 300,
    });

    const res = await controller.registerFamilyRep(dto);
    expect(service.registerFamilyRep).toHaveBeenCalledWith(dto);
    expect(res).toEqual({
      message: 'OTP sent',
      email: dto.email,
      expiresInSeconds: 300,
    });
  });

  it('[UT-C-02] verifyEmailOtp ủy quyền gọi service.verifyEmailOtp', async () => {
    const dto = { email: 'a@famidoc.vn', otp: '123456' };
    const mockUser: any = { id: 'u-1', email: dto.email, role: 'FAMILY_REP' };
    service.verifyEmailOtp.mockResolvedValue(mockUser);

    const res = await controller.verifyEmailOtp(dto);
    expect(service.verifyEmailOtp).toHaveBeenCalledWith(dto);
    expect(res).toEqual(mockUser);
  });

  it('[UT-C-03] resendEmailOtp ủy quyền gọi service.resendEmailOtp', async () => {
    const dto = { email: 'a@famidoc.vn' };
    service.resendEmailOtp.mockResolvedValue({
      message: 'Resent',
      success: true,
    });

    const res = await controller.resendEmailOtp(dto);
    expect(service.resendEmailOtp).toHaveBeenCalledWith(dto);
    expect(res).toEqual({ message: 'Resent', success: true });
  });

  it('[UT-C-04] login ủy quyền gọi service.login', async () => {
    const dto = { identifier: 'a@famidoc.vn', password: 'Pass' };
    const req: any = { ip: '127.0.0.1' };
    const loginRes: any = { accessToken: 'token', role: 'FAMILY_REP' };
    service.login.mockResolvedValue(loginRes);

    const res = await controller.login(dto, req);
    expect(service.login).toHaveBeenCalledWith(dto, req.ip);
    expect(res).toEqual(loginRes);
  });

  it('[UT-C-05] logout ủy quyền gọi service.logout', async () => {
    const req: any = {
      user: { id: 'u-1' },
      headers: { authorization: 'Bearer token_xyz' },
    };
    service.logout.mockResolvedValue();

    await controller.logout(req);
    expect(service.logout).toHaveBeenCalled();
  });

  it('[UT-C-06] forgotPassword ủy quyền gọi service.forgotPassword', async () => {
    const dto = { email: 'a@famidoc.vn' };
    service.forgotPassword.mockResolvedValue({
      message: 'Sent',
      success: true,
    });

    const res = await controller.forgotPassword(dto);
    expect(service.forgotPassword).toHaveBeenCalledWith(dto);
    expect(res).toEqual({ message: 'Sent', success: true });
  });

  it('[UT-C-07] resetPassword ủy quyền gọi service.resetPassword', async () => {
    const dto = {
      email: 'a@famidoc.vn',
      otp: '123456',
      newPassword: 'NewPassword@123',
    };
    service.resetPassword.mockResolvedValue({
      message: 'Reset ok',
      success: true,
    });

    const res = await controller.resetPassword(dto);
    expect(service.resetPassword).toHaveBeenCalledWith(dto);
    expect(res).toEqual({ message: 'Reset ok', success: true });
  });

  it('[UT-C-08] changePassword ủy quyền gọi service.changePassword', async () => {
    const dto = { oldPassword: 'Old', newPassword: 'NewPassword@123' };
    const req: any = { user: { id: 'u-1' } };
    service.changePassword.mockResolvedValue({
      message: 'Changed ok',
      success: true,
    });

    const res = await controller.changePassword(req, dto);
    expect(service.changePassword).toHaveBeenCalled();
    expect(res).toEqual({ message: 'Changed ok', success: true });
  });
});
