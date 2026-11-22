import 'reflect-metadata';
import { ConflictException, NotFoundException } from '@nestjs/common';
import type { AuthenticatedUser } from '../../../core/auth/authenticated-request';
import { AdminController } from '../admin.controller';
import { AdminService } from '../admin.service';

describe('AdminService.updateDoctorPanelCapacity', () => {
  let service: AdminService;
  let mockTx: any;
  let mockDb: any;

  const adminActor: AuthenticatedUser = {
    id: 'admin-1',
    role: 'ADMIN',
  } as AuthenticatedUser;

  beforeEach(() => {
    mockTx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'doc-1' }]),
      doctor: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'doc-1',
          doctorName: 'BS. Nguyễn Văn An',
          maxPanelCapacity: 5,
        }),
        update: jest.fn().mockResolvedValue({
          id: 'doc-1',
          doctorName: 'BS. Nguyễn Văn An',
          maxPanelCapacity: 8,
          activePanelCount: 3,
        }),
      },
      medicalContract: {
        count: jest.fn().mockResolvedValue(3),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
      },
    };

    mockDb = {
      $transaction: jest.fn().mockImplementation((fn: any) => fn(mockTx)),
    };

    service = new AdminService(mockDb, {} as any);
  });

  it('bảo vệ route PATCH admin/doctors/:id/panel-capacity chỉ cho vai trò ADMIN', () => {
    const classRoles = Reflect.getMetadata('allowedRoles', AdminController);
    expect(classRoles).toEqual(['ADMIN']);
  });

  it('cập nhật maxPanelCapacity và ghi AuditLog khi giá trị >= activeAndHeldCount', async () => {
    const res = await service.updateDoctorPanelCapacity(
      adminActor,
      'doc-1',
      { maxPanelCapacity: 8, reason: 'Điều chỉnh tăng cho bác sĩ trưởng khoa' },
      '127.0.0.1',
    );

    expect(res.maxPanelCapacity).toBe(8);
    expect(mockTx.doctor.update).toHaveBeenCalledWith({
      where: { id: 'doc-1' },
      data: { maxPanelCapacity: 8 },
      select: { id: true, doctorName: true, maxPanelCapacity: true, activePanelCount: true },
    });
    expect(mockTx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: 'admin-1',
        action: 'ADMIN_UPDATE_DOCTOR_PANEL_CAPACITY',
        resourceName: 'Doctor',
        resourceId: 'doc-1',
        metadata: {
          previousMaxPanel: 5,
          newMaxPanel: 8,
          reason: 'Điều chỉnh tăng cho bác sĩ trưởng khoa',
        },
      }),
    });
  });

  it('ném 409 Conflict khi maxPanelCapacity mới nhỏ hơn activeAndHeldCount', async () => {
    mockTx.medicalContract.count.mockResolvedValueOnce(4);

    await expect(
      service.updateDoctorPanelCapacity(adminActor, 'doc-1', {
        maxPanelCapacity: 3,
        reason: 'Giảm hạn mức',
      }),
    ).rejects.toThrow(ConflictException);
    expect(mockTx.doctor.update).not.toHaveBeenCalled();
  });

  it('ném 404 NotFoundException khi không tìm thấy bác sĩ', async () => {
    mockTx.doctor.findUnique.mockResolvedValueOnce(null);

    await expect(
      service.updateDoctorPanelCapacity(adminActor, 'missing-doc', {
        maxPanelCapacity: 5,
        reason: 'Kiểm tra không tồn tại',
      }),
    ).rejects.toThrow(NotFoundException);
  });
});
