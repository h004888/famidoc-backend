import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from '../controllers/users.controller';
import {
  USERS_SERVICE_TOKEN,
  IUsersService,
} from '../services/interfaces/users.service.interface';
import { JwtAuthGuard } from '../../../core/auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../../../core/auth/authenticated-request';

describe('UsersController (/me and /users aliases)', () => {
  let controller: UsersController;
  let service: jest.Mocked<IUsersService>;

  const mockReq = {
    user: { id: 'user-uuid-1', role: 'FAMILY_REP' },
  } as unknown as AuthenticatedRequest;

  const mockProfile = {
    id: 'user-uuid-1',
    email: 'user@famidoc.vn',
    phone: '0912345678',
    fullName: 'Nguyễn Văn An',
    avatarUrl: null,
    address: 'Hà Nội',
    dateOfBirth: null,
    gender: null,
    role: 'FAMILY_REP',
  };

  beforeEach(async () => {
    service = {
      getCurrentUserProfile: jest.fn().mockResolvedValue(mockProfile),
      updateUserProfile: jest.fn().mockResolvedValue(mockProfile),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        {
          provide: USERS_SERVICE_TOKEN,
          useValue: service,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<UsersController>(UsersController);
  });

  it('should support /me alias in controller path metadata', () => {
    const path = Reflect.getMetadata('path', UsersController);
    const paths = Array.isArray(path) ? path : [path];
    expect(paths).toContain('api/v1/me');
    expect(paths).toContain('api/v1/users');
  });

  it('should delegate getCurrentUserProfile to service', async () => {
    const result = await controller.getCurrentUserProfile(mockReq);
    expect(result).toBe(mockProfile);
    expect(service.getCurrentUserProfile).toHaveBeenCalledWith('user-uuid-1');
  });

  it('should delegate updateUserProfile to service', async () => {
    const dto = { fullName: 'Nguyễn Văn Bình' };
    const result = await controller.updateUserProfile(mockReq, dto as any);
    expect(result).toBe(mockProfile);
    expect(service.updateUserProfile).toHaveBeenCalledWith('user-uuid-1', dto);
  });
});

