import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AuthenticatedUser } from '../../../core/auth/authenticated-request';
import { DoctorQuotaProposalsService } from '../services/doctor-quota-proposals.service';
import { DoctorQuotaProposalsController } from '../controllers/doctor-quota-proposals.controller';
import { PrismaService } from '../../../core/database/prisma.service';
import { JwtAuthGuard } from '../../../core/auth/jwt-auth.guard';
import { RolesGuard } from '../../../core/auth/roles.guard';

describe('DoctorQuotaProposals (Task 2.2)', () => {
  let service: DoctorQuotaProposalsService;
  let controller: DoctorQuotaProposalsController;
  let prismaMock: any;

  const facilityUser: AuthenticatedUser = {
    id: 'fac-user-1',
    role: 'HEALTHCARE_FACILITY',
    familyUnitId: null,
  };

  const adminUser: AuthenticatedUser = {
    id: 'admin-user-1',
    role: 'ADMIN',
    familyUnitId: null,
  };

  beforeEach(async () => {
    prismaMock = {
      healthcareFacility: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'fac-1',
          userId: 'fac-user-1',
          facilityName: 'Phòng khám FamiDoc',
          verificationStatus: 'ACTIVE',
        }),
      },
      doctor: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'doc-1',
          facilityId: 'fac-1',
          doctorName: 'BS. Nguyễn Văn An',
          maxPanelCapacity: 30,
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      medicalContract: {
        findMany: jest.fn().mockResolvedValue(
          Array.from({ length: 18 }, () => ({ doctorId: 'doc-1' })),
        ),
        count: jest.fn().mockResolvedValue(18),
      },
      doctorQuotaProposal: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockImplementation(({ data }) => ({
          id: 'prop-1',
          ...data,
          doctor: {
            id: 'doc-1',
            doctorName: 'BS. Nguyễn Văn An',
            specialty: 'Y học gia đình',
            clinicalTier: 'STANDARD',
            maxPanelCapacity: 30,
            activePanelCount: 15,
          },
          facility: { id: 'fac-1', facilityName: 'Phòng khám FamiDoc' },
        })),
        update: jest.fn().mockImplementation(({ data }) => ({
          id: 'prop-1',
          doctorId: 'doc-1',
          facilityId: 'fac-1',
          currentMaxPanel: 30,
          requestedMaxPanel: 40,
          ...data,
        })),
      },
      user: {
        findMany: jest.fn().mockResolvedValue([{ id: 'admin-user-1' }]),
      },
      notification: {
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({ id: 1n }),
      },
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'doc-1' }]),
      $transaction: jest.fn().mockImplementation(async (cb) => cb(prismaMock)),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [DoctorQuotaProposalsController],
      providers: [
        DoctorQuotaProposalsService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    service = moduleRef.get(DoctorQuotaProposalsService);
    controller = moduleRef.get(DoctorQuotaProposalsController);
  });

  it('allows facility to submit a quota proposal and notifies admins', async () => {
    const res = await controller.createFacilityQuotaProposal(
      { user: facilityUser, ip: '127.0.0.1' } as any,
      'doc-1',
      { requestedMaxPanel: 40, reason: 'Bổ sung điều dưỡng hỗ trợ hộ gia đình' },
    );

    expect(res.status).toBe('PENDING');
    expect(res.requestedMaxPanel).toBe(40);
    expect(prismaMock.notification.createMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.doctor.update).not.toHaveBeenCalled();
  });

  it('rejects proposal when requestedMaxPanel is lower than activeAndHeldCount', async () => {
    await expect(
      service.createProposal(
        facilityUser,
        'doc-1',
        { requestedMaxPanel: 10, reason: 'Giảm tải cho bác sĩ đi công tác' },
        '127.0.0.1',
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('approves valid proposal, updates maxPanelCapacity, and notifies facility', async () => {
    prismaMock.doctorQuotaProposal.findUnique.mockResolvedValue({
      id: 'prop-1',
      doctorId: 'doc-1',
      facilityId: 'fac-1',
      requestedByUserId: 'fac-user-1',
      currentMaxPanel: 30,
      requestedMaxPanel: 40,
      status: 'PENDING',
      doctor: { id: 'doc-1', doctorName: 'BS. Nguyễn Văn An', maxPanelCapacity: 30 },
      facility: { id: 'fac-1', facilityName: 'Phòng khám FamiDoc', userId: 'fac-user-1' },
    });

    const res = await controller.reviewQuotaProposal(
      { user: adminUser, ip: '127.0.0.1' } as any,
      'prop-1',
      { action: 'APPROVE', reviewNote: 'Chấp thuận tăng hạn mức' },
    );

    expect(res.status).toBe('APPROVED');
    expect(prismaMock.doctor.update).toHaveBeenCalledWith({
      where: { id: 'doc-1' },
      data: { maxPanelCapacity: 40 },
    });
    expect(prismaMock.notification.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            userId: 'fac-user-1',
            type: 'DOCTOR_QUOTA_PROPOSAL_APPROVED',
          }),
        ]),
      }),
    );
  });

  it('blocks approval when activeAndHeldCount grew above requestedMaxPanel', async () => {
    prismaMock.doctorQuotaProposal.findUnique.mockResolvedValue({
      id: 'prop-1',
      doctorId: 'doc-1',
      facilityId: 'fac-1',
      requestedByUserId: 'fac-user-1',
      currentMaxPanel: 30,
      requestedMaxPanel: 20,
      status: 'PENDING',
      doctor: { id: 'doc-1', doctorName: 'BS. Nguyễn Văn An', maxPanelCapacity: 30 },
      facility: { id: 'fac-1', facilityName: 'Phòng khám FamiDoc', userId: 'fac-user-1' },
    });
    prismaMock.medicalContract.count.mockResolvedValue(22);

    await expect(
      service.reviewProposal(
        adminUser,
        'prop-1',
        { action: 'APPROVE' },
        '127.0.0.1',
      ),
    ).rejects.toThrow(ConflictException);
    expect(prismaMock.doctor.update).not.toHaveBeenCalled();
  });

  it('rejects proposal with reviewNote and notifies facility without changing maxPanelCapacity', async () => {
    prismaMock.doctorQuotaProposal.findUnique.mockResolvedValue({
      id: 'prop-1',
      doctorId: 'doc-1',
      facilityId: 'fac-1',
      requestedByUserId: 'fac-user-1',
      currentMaxPanel: 30,
      requestedMaxPanel: 50,
      status: 'PENDING',
      doctor: { id: 'doc-1', doctorName: 'BS. Nguyễn Văn An', maxPanelCapacity: 30 },
      facility: { id: 'fac-1', facilityName: 'Phòng khám FamiDoc', userId: 'fac-user-1' },
    });

    const res = await controller.reviewQuotaProposal(
      { user: adminUser, ip: '127.0.0.1' } as any,
      'prop-1',
      { action: 'REJECT', reviewNote: 'Chưa đủ nhân sự hỗ trợ đi kèm' },
    );

    expect(res.status).toBe('REJECTED');
    expect(prismaMock.doctor.update).not.toHaveBeenCalled();
    expect(prismaMock.notification.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            userId: 'fac-user-1',
            type: 'DOCTOR_QUOTA_PROPOSAL_REJECTED',
          }),
        ]),
      }),
    );
  });

  it('requires reviewNote when rejecting and forbids non-admin from reviewing', async () => {
    await expect(
      service.reviewProposal(
        adminUser,
        'prop-1',
        { action: 'REJECT', reviewNote: '   ' },
        '127.0.0.1',
      ),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.reviewProposal(
        facilityUser,
        'prop-1',
        { action: 'APPROVE' },
        '127.0.0.1',
      ),
    ).rejects.toThrow(ForbiddenException);
  });
});
