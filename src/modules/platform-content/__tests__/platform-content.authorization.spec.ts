import {
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { JwtAuthGuard } from '../../../core/auth/jwt-auth.guard';
import { RolesGuard } from '../../../core/auth/roles.guard';
import type { AuthenticatedRequest } from '../../../core/auth/authenticated-request';
import { AdminTreatedCasesController } from '../controllers/admin-treated-cases.controller';
import { AdminPlatformCareController } from '../controllers/admin-platform-care.controller';
import { PlatformContentService } from '../services/platform-content.service';
import { CreatePlatformCareItemDto } from '../dtos/create-platform-care-item.dto';

describe('Platform content authorization', () => {
  it('protects both admin controllers with JWT and ADMIN role', () => {
    for (const controller of [
      AdminTreatedCasesController,
      AdminPlatformCareController,
    ]) {
      expect(Reflect.getMetadata('allowedRoles', controller)).toEqual([
        'ADMIN',
      ]);
      expect(Reflect.getMetadata('__guards__', controller)).toEqual([
        JwtAuthGuard,
        RolesGuard,
      ]);
    }
  });

  it('returns 401 when the bearer token is missing', async () => {
    const guard = new JwtAuthGuard(
      { verifyAsync: jest.fn() } as unknown as JwtService,
      { user: { findUnique: jest.fn() } } as any,
      new Reflector(),
    );

    const context = {
      switchToHttp: () => ({ getRequest: () => ({ headers: {} }) }),
      getHandler: () => AdminTreatedCasesController.prototype.list,
      getClass: () => AdminTreatedCasesController,
    } as any;

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('returns 403 for a non-admin role', () => {
    const guard = new RolesGuard(new Reflector());
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          user: { id: 'user-1', role: 'DOCTOR', familyUnitId: null },
        }),
      }),
      getHandler: () => AdminTreatedCasesController.prototype.list,
      getClass: () => AdminTreatedCasesController,
    } as any;

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  describe('controller delegation', () => {
    let treated: AdminTreatedCasesController;
    let care: AdminPlatformCareController;
    const service = {
      listTreatedCases: jest.fn(),
      createTreatedCase: jest.fn(),
      updateTreatedCase: jest.fn(),
      approveTreatedCase: jest.fn(),
      rejectTreatedCase: jest.fn(),
      listCareItems: jest.fn(),
      createCareItem: jest.fn(),
      updateCareItem: jest.fn(),
      deactivateCareItem: jest.fn(),
    };

    const request = {
      user: { id: 'admin-1', role: 'ADMIN', familyUnitId: null },
    } as unknown as AuthenticatedRequest;

    const doctorId = '550e8400-e29b-41d4-a716-446655440000';
    const caseId = '650e8400-e29b-41d4-a716-446655440001';
    const careId = '750e8400-e29b-41d4-a716-446655440002';

    beforeEach(async () => {
      jest.clearAllMocks();

      const module: TestingModule = await Test.createTestingModule({
        controllers: [AdminTreatedCasesController, AdminPlatformCareController],
        providers: [{ provide: PlatformContentService, useValue: service }],
      })
        .overrideGuard(JwtAuthGuard)
        .useValue({ canActivate: () => true })
        .overrideGuard(RolesGuard)
        .useValue({ canActivate: () => true })
        .compile();

      treated = module.get(AdminTreatedCasesController);
      care = module.get(AdminPlatformCareController);
    });

    it('delegates treated case operations', async () => {
      await treated.list(doctorId);
      expect(service.listTreatedCases).toHaveBeenCalledWith(doctorId);

      await treated.create(doctorId, { summary: 'Nội dung đủ dài hợp lệ.' });
      expect(service.createTreatedCase).toHaveBeenCalledWith(doctorId, {
        summary: 'Nội dung đủ dài hợp lệ.',
      });

      await treated.approve(doctorId, caseId, request);
      expect(service.approveTreatedCase).toHaveBeenCalledWith(
        doctorId,
        caseId,
        'admin-1',
      );

      await treated.reject(doctorId, caseId, { reason: 'Thiếu căn cứ.' }, request);
      expect(service.rejectTreatedCase).toHaveBeenCalledWith(
        doctorId,
        caseId,
        'admin-1',
        'Thiếu căn cứ.',
      );
    });

    it('delegates care content operations', async () => {
      await care.list();
      expect(service.listCareItems).toHaveBeenCalled();

      await care.create({ category: 'SERVICE_MODE', title: 'Khám tận nhà' });
      expect(service.createCareItem).toHaveBeenCalledWith({
        category: 'SERVICE_MODE',
        title: 'Khám tận nhà',
      });

      await care.update(careId, { title: 'Khám tại nhà' });
      expect(service.updateCareItem).toHaveBeenCalledWith(careId, {
        title: 'Khám tại nhà',
      });

      await care.deactivate(careId);
      expect(service.deactivateCareItem).toHaveBeenCalledWith(careId);
    });
  });

  describe('care item validation', () => {
    it('rejects a missing title', async () => {
      const errors = await validate(
        plainToInstance(CreatePlatformCareItemDto, {
          category: 'SERVICE_MODE',
        }),
      );

      expect(errors.some((error) => error.property === 'title')).toBe(true);
    });

    it('rejects an invalid category', async () => {
      const errors = await validate(
        plainToInstance(CreatePlatformCareItemDto, {
          category: 'INVALID',
          title: 'Tiêu đề hợp lệ',
        }),
      );

      expect(errors.some((error) => error.property === 'category')).toBe(true);
    });
  });
});
