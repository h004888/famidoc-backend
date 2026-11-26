import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import type { AuthenticatedUser } from '../../../core/auth/authenticated-request';
import { AdminUpdateRevenueConfigDto } from '../admin.dto';
import { AdminService } from '../admin.service';

describe('AdminService revenue config', () => {
  const actor = { id: 'admin-1', role: 'ADMIN' } as AuthenticatedUser;
  let tx: any;
  let db: any;
  let service: AdminService;

  beforeEach(() => {
    tx = {
      systemConfiguration: {
        findMany: jest.fn().mockResolvedValue([
          { configKey: 'FACILITY_REVENUE_RATE', configValue: '85', updatedAt: new Date('2026-11-01') },
          { configKey: 'PLATFORM_COMMISSION_RATE', configValue: '15', updatedAt: new Date('2026-11-01') },
        ]),
        upsert: jest.fn().mockResolvedValue({}),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    db = {
      systemConfiguration: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)),
    };
    service = new AdminService(db, {} as any);
  });

  it('trả mặc định 85/15 khi chưa có cấu hình', async () => {
    await expect(service.getRevenueConfig()).resolves.toMatchObject({
      facilityRevenueRate: 85,
      platformCommissionRate: 15,
    });
  });

  it('từ chối khi tổng khác 100%', async () => {
    await expect(
      service.updateRevenueConfig(actor, { facilityRevenueRate: 80, platformCommissionRate: 15 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('lưu cả hai khóa và ghi audit giá trị cũ/mới', async () => {
    await service.updateRevenueConfig(actor, { facilityRevenueRate: 80, platformCommissionRate: 20 }, '1.2.3.4');
    expect(tx.systemConfiguration.upsert).toHaveBeenCalledTimes(2);
    expect(tx.systemConfiguration.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { configKey: 'FACILITY_REVENUE_RATE' },
        update: { configValue: '80', updatedBy: 'admin-1' },
      }),
    );
    const audit = tx.auditLog.create.mock.calls[0][0].data;
    expect(audit).toMatchObject({ action: 'ADMIN_UPDATE_REVENUE_CONFIG', clientIp: '1.2.3.4' });
    expect(JSON.stringify(audit.metadata)).toContain('85');
    expect(JSON.stringify(audit.metadata)).toContain('80');
  });

  it('DTO chặn tỷ lệ ngoài khoảng', () => {
    const dto = plainToInstance(AdminUpdateRevenueConfigDto, { facilityRevenueRate: 40, platformCommissionRate: 60 });
    expect(validateSync(dto).length).toBeGreaterThan(0);
    const ok = plainToInstance(AdminUpdateRevenueConfigDto, { facilityRevenueRate: 80, platformCommissionRate: 20 });
    expect(validateSync(ok)).toHaveLength(0);
  });
});
