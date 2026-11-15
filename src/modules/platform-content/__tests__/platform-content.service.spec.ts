import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../core/database/prisma.service';
import { PlatformContentService } from '../services/platform-content.service';

describe('PlatformContentService', () => {
  const doctorId = '550e8400-e29b-41d4-a716-446655440000';
  const caseId = '650e8400-e29b-41d4-a716-446655440001';
  const careId = '750e8400-e29b-41d4-a716-446655440002';
  let service: PlatformContentService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      doctor: { findUnique: jest.fn() },
      doctorTreatedCase: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      platformCareItem: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlatformContentService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<PlatformContentService>(PlatformContentService);
    prisma.doctor.findUnique.mockResolvedValue({ id: doctorId });
  });

  it('creates a treated case in PENDING status', async () => {
    prisma.doctorTreatedCase.create.mockImplementation(({ data }: any) => ({
      id: caseId,
      ...data,
    }));

    const result = await service.createTreatedCase(doctorId, {
      summary: 'Quản lý tăng huyết áp kháng trị cho bệnh nhân 72 tuổi.',
    });

    expect(prisma.doctorTreatedCase.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        doctorId,
        status: 'PENDING',
      }),
    });
    expect(result.status).toBe('PENDING');
  });

  it('approves a treated case with reviewer information', async () => {
    prisma.doctorTreatedCase.findFirst.mockResolvedValue({ id: caseId });
    prisma.doctorTreatedCase.update.mockImplementation(({ data }: any) => ({
      id: caseId,
      ...data,
    }));

    const result = await service.approveTreatedCase(doctorId, caseId, 'admin-1');

    expect(prisma.doctorTreatedCase.update).toHaveBeenCalledWith({
      where: { id: caseId },
      data: expect.objectContaining({
        status: 'APPROVED',
        approvedBy: 'admin-1',
        rejectionReason: null,
      }),
    });
    expect(result.status).toBe('APPROVED');
  });

  it('rejects a treated case with a reason', async () => {
    prisma.doctorTreatedCase.findFirst.mockResolvedValue({ id: caseId });
    prisma.doctorTreatedCase.update.mockImplementation(({ data }: any) => ({
      id: caseId,
      ...data,
    }));

    const result = await service.rejectTreatedCase(
      doctorId,
      caseId,
      'admin-1',
      'Thiếu căn cứ xác thực.',
    );

    expect(prisma.doctorTreatedCase.update).toHaveBeenCalledWith({
      where: { id: caseId },
      data: expect.objectContaining({
        status: 'REJECTED',
        approvedBy: 'admin-1',
        rejectionReason: 'Thiếu căn cứ xác thực.',
      }),
    });
    expect(result.status).toBe('REJECTED');
  });

  it('returns an edited treated case to PENDING for re-approval', async () => {
    prisma.doctorTreatedCase.findFirst.mockResolvedValue({
      id: caseId,
      summary: 'Nội dung cũ',
    });
    prisma.doctorTreatedCase.update.mockImplementation(({ data }: any) => ({
      id: caseId,
      ...data,
    }));

    const result = await service.updateTreatedCase(doctorId, caseId, {
      summary: 'Nội dung mới đủ dài để hợp lệ.',
    });

    expect(prisma.doctorTreatedCase.update).toHaveBeenCalledWith({
      where: { id: caseId },
      data: expect.objectContaining({
        summary: 'Nội dung mới đủ dài để hợp lệ.',
        status: 'PENDING',
        approvedBy: null,
        approvedAt: null,
        rejectionReason: null,
      }),
    });
    expect(result.status).toBe('PENDING');
  });

  it('rejects unknown doctors and unknown treated cases', async () => {
    prisma.doctor.findUnique.mockResolvedValue(null);
    await expect(service.listTreatedCases(doctorId)).rejects.toThrow(
      NotFoundException,
    );

    prisma.doctor.findUnique.mockResolvedValue({ id: doctorId });
    prisma.doctorTreatedCase.findFirst.mockResolvedValue(null);
    await expect(
      service.approveTreatedCase(doctorId, caseId, 'admin-1'),
    ).rejects.toThrow(NotFoundException);
  });

  it('appends a new care item to the end of its category', async () => {
    prisma.platformCareItem.findFirst.mockResolvedValue({ sortOrder: 2 });
    prisma.platformCareItem.create.mockImplementation(({ data }: any) => ({
      id: careId,
      ...data,
    }));

    const result = await service.createCareItem({
      category: 'SERVICE_MODE',
      title: 'Khám tận nhà',
    });

    expect(prisma.platformCareItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        category: 'SERVICE_MODE',
        title: 'Khám tận nhà',
        description: '',
        sortOrder: 3,
        isActive: true,
      }),
    });
    expect(result.sortOrder).toBe(3);
  });

  it('updates and deactivates a care item', async () => {
    prisma.platformCareItem.findUnique.mockResolvedValue({ id: careId });
    prisma.platformCareItem.update.mockImplementation(({ data }: any) => ({
      id: careId,
      ...data,
    }));

    await service.updateCareItem(careId, { title: 'Khám tại nhà' });
    expect(prisma.platformCareItem.update).toHaveBeenCalledWith({
      where: { id: careId },
      data: { title: 'Khám tại nhà' },
    });

    const result = await service.deactivateCareItem(careId);
    expect(prisma.platformCareItem.update).toHaveBeenLastCalledWith({
      where: { id: careId },
      data: { isActive: false },
    });
    expect(result.isActive).toBe(false);
  });
});
