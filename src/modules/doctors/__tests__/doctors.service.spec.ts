import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { DoctorsServiceImpl } from '../services/impl/doctors.service.impl';
import { PrismaService } from '../../../core/database/prisma.service';
import type { AuthenticatedUser } from '../../../core/auth/authenticated-request';
import { DoctorCredentialType, DoctorOnboardingStatus } from '@prisma/client';

describe('DoctorsServiceImpl', () => {
  let service: DoctorsServiceImpl;
  let prismaService: any;
  let mailerService: any;

  const adminUser: AuthenticatedUser = {
    id: 'admin-uuid-1',
    role: 'ADMIN',
    familyUnitId: null,
  };

  const facilityUser: AuthenticatedUser = {
    id: 'facility-user-uuid-1',
    role: 'HEALTHCARE_FACILITY',
    familyUnitId: null,
  };

  const doctorUser: AuthenticatedUser = {
    id: 'doctor-user-uuid-1',
    role: 'DOCTOR',
    familyUnitId: null,
  };

  const mockFacility = {
    id: 'fac-uuid-1',
    userId: 'facility-user-uuid-1',
    facilityName: 'Bệnh viện Hoàn Mỹ',
    verificationStatus: 'ACTIVE',
  };

  const mockDoctor = {
    id: 'doc-uuid-1',
    userId: 'doctor-user-uuid-1',
    facilityId: 'fac-uuid-1',
    doctorName: 'BS. CKI Nguyễn Văn An',
    specialty: 'Y học gia đình',
    academicTitle: 'BS.CKI',
    experienceYears: 8,
    bio: 'Chuyên gia Y học gia đình',
    activePanelCount: 0,
    maxPanelCapacity: 30,
    ratingAvg: '5.00',
    totalReviews: 0,
    onboardingStatus: DoctorOnboardingStatus.PENDING_SUBMISSION,
    createdAt: new Date(),
    updatedAt: new Date(),
    facility: mockFacility,
    credentials: [],
  };

  beforeEach(async () => {
    mailerService = {
      sendMail: jest.fn().mockResolvedValue({ messageId: 'msg-1' }),
    };

    prismaService = {
      healthcareFacility: {
        findUnique: jest.fn().mockResolvedValue(mockFacility),
      },
      b2bStaffingContract: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'b2b-1',
          facilityId: 'fac-uuid-1',
          status: 'ACTIVE',
          endDate: new Date(Date.now() + 86400000 * 365),
        }),
      },
      user: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest
          .fn()
          .mockResolvedValue({
            id: 'doctor-user-uuid-1',
            email: 'doc@famidoc.vn',
          }),
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'admin-uuid-1', role: 'ADMIN' }]),
        create: jest.fn().mockResolvedValue({ id: 'new-user-uuid-1' }),
        update: jest
          .fn()
          .mockResolvedValue({ id: 'new-user-uuid-1', status: 'ACTIVE' }),
      },
      notification: {
        create: jest.fn().mockResolvedValue({ id: 'notif-uuid-1' }),
      },
      doctor: {
        findUnique: jest.fn().mockResolvedValue(mockDoctor),
        create: jest.fn().mockResolvedValue(mockDoctor),
        update: jest.fn().mockResolvedValue(mockDoctor),
      },
      doctorCredential: {
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({ id: 1n }),
      },
      $transaction: jest.fn().mockImplementation(async (cb) => {
        return cb(prismaService);
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DoctorsServiceImpl,
        {
          provide: PrismaService,
          useValue: prismaService,
        },
        {
          provide: 'MAILER_SERVICE',
          useValue: mailerService,
        },
      ],
    }).compile();

    service = module.get<DoctorsServiceImpl>(DoctorsServiceImpl);
  });

  describe('provisionDoctorAccount (STT 15 - UC-20)', () => {
    const dto = {
      email: 'bs.an@famidoc.vn',
      phone: '0912345678',
      doctorName: 'BS. CKI Nguyễn Văn An',
      specialty: 'Y học gia đình',
      experienceYears: 8,
      facilityId: 'fac-uuid-1',
    };

    it('should allow ADMIN to provision doctor for active facility', async () => {
      const result = await service.provisionDoctorAccount(
        adminUser,
        dto,
        '127.0.0.1',
      );

      expect(result).toBeDefined();
      expect(result.doctorName).toBe('BS. CKI Nguyễn Văn An');
      expect(result.onboardingStatus).toBe(
        DoctorOnboardingStatus.PENDING_SUBMISSION,
      );
      expect(prismaService.user.create).toHaveBeenCalled();
      expect(prismaService.doctor.create).toHaveBeenCalled();
      expect(prismaService.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'DOCTOR_ACCOUNT_PROVISIONED',
          resourceName: 'Doctor',
        }),
      });
    });

    it('should allow HEALTHCARE_FACILITY to provision doctor for its own facility', async () => {
      const { facilityId: _, ...facilityDto } = dto;

      const result = await service.provisionDoctorAccount(
        facilityUser,
        facilityDto,
        '127.0.0.1',
      );

      expect(result).toBeDefined();
      expect(prismaService.healthcareFacility.findUnique).toHaveBeenCalledWith({
        where: { userId: facilityUser.id },
      });
    });

    it('should throw BadRequestException if facility has no active B2B staffing contract', async () => {
      prismaService.b2bStaffingContract.findFirst.mockResolvedValue(null);

      await expect(
        service.provisionDoctorAccount(adminUser, dto, '127.0.0.1'),
      ).rejects.toThrow(
        new BadRequestException(
          'Cơ sở y tế chưa có hợp đồng nhân lực B2B đang có hiệu lực',
        ),
      );
    });

    it('should send welcome email when doctor is provisioned', async () => {
      await service.provisionDoctorAccount(adminUser, dto, '127.0.0.1');

      expect(mailerService.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: dto.email,
        }),
      );
    });

    it('should throw ConflictException if email or phone already exists', async () => {
      prismaService.user.findFirst.mockResolvedValue({ id: 'existing-user' });

      await expect(
        service.provisionDoctorAccount(adminUser, dto, '127.0.0.1'),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw BadRequestException if facility does not exist', async () => {
      prismaService.healthcareFacility.findUnique.mockResolvedValue(null);

      await expect(
        service.provisionDoctorAccount(adminUser, dto, '127.0.0.1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('submitDoctorCredentials (STT 16 - UC-21)', () => {
    const credDto = {
      credentials: [
        {
          credentialType: DoctorCredentialType.PRACTICE_LICENSE_CCHN,
          certificateNumber: 'CCHN-123',
          issueDate: '2020-01-01',
          issuingAuthority: 'Bộ Y tế',
          fileUrl: 'https://cdn.famidoc.vn/cchn.pdf',
        },
      ],
    };

    it('should allow doctor to upload credentials', async () => {
      const result = await service.submitDoctorCredentials(
        doctorUser,
        'doc-uuid-1',
        credDto,
        '127.0.0.1',
      );

      expect(result).toBeDefined();
      expect(prismaService.doctorCredential.deleteMany).toHaveBeenCalledWith({
        where: { doctorId: 'doc-uuid-1' },
      });
      expect(prismaService.doctorCredential.createMany).toHaveBeenCalled();
      expect(prismaService.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'DOCTOR_CREDENTIALS_SUBMITTED',
        }),
      });
      expect(prismaService.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: mockFacility.userId,
          type: 'DOCTOR_CREDENTIALS_SUBMITTED',
        }),
      });
    });

    it('should allow doctor to upload credentials using "me" alias', async () => {
      prismaService.doctor.findFirst = jest.fn().mockResolvedValue(mockDoctor);

      const result = await service.submitDoctorCredentials(
        doctorUser,
        'me',
        credDto,
        '127.0.0.1',
      );

      expect(result).toBeDefined();
    });

    it('should throw ForbiddenException if doctor tries to update another doctor', async () => {
      const otherDoctor: AuthenticatedUser = {
        id: 'other-doc-uuid',
        role: 'DOCTOR',
        familyUnitId: null,
      };

      await expect(
        service.submitDoctorCredentials(
          otherDoctor,
          'doc-uuid-1',
          credDto,
          '127.0.0.1',
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw BadRequestException if doctor is already ACTIVE', async () => {
      prismaService.doctor.findUnique.mockResolvedValue({
        ...mockDoctor,
        onboardingStatus: DoctorOnboardingStatus.ACTIVE,
      });

      await expect(
        service.submitDoctorCredentials(
          doctorUser,
          'doc-uuid-1',
          credDto,
          '127.0.0.1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if credential issueDate is in the future', async () => {
      prismaService.doctor.findUnique.mockResolvedValue({
        ...mockDoctor,
        onboardingStatus: DoctorOnboardingStatus.PENDING_SUBMISSION,
      });

      const futureDateDto = {
        credentials: [
          {
            ...credDto.credentials[0],
            issueDate: '2099-01-01',
          },
        ],
      };

      await expect(
        service.submitDoctorCredentials(
          doctorUser,
          'doc-uuid-1',
          futureDateDto,
          '127.0.0.1',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('approveDoctorCredentialsByFacility (STT 17 - UC-22)', () => {
    it('should approve doctor credentials and update status to FACILITY_VERIFIED', async () => {
      prismaService.doctor.findUnique.mockResolvedValue({
        ...mockDoctor,
        credentials: [
          {
            id: 'cred-1',
            credentialType: DoctorCredentialType.PRACTICE_LICENSE_CCHN,
          },
        ],
      });

      prismaService.doctor.update.mockResolvedValue({
        ...mockDoctor,
        onboardingStatus: DoctorOnboardingStatus.FACILITY_VERIFIED,
      });

      const result = await service.approveDoctorCredentialsByFacility(
        facilityUser,
        'doc-uuid-1',
        { approved: true },
        '127.0.0.1',
      );

      expect(result.onboardingStatus).toBe(
        DoctorOnboardingStatus.FACILITY_VERIFIED,
      );
      expect(prismaService.doctorCredential.updateMany).toHaveBeenCalledWith({
        where: { doctorId: 'doc-uuid-1' },
        data: expect.objectContaining({
          facilityVerified: true,
          facilityVerifiedBy: facilityUser.id,
        }),
      });
      expect(prismaService.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: 'DOCTOR_FACILITY_VERIFIED',
        }),
      });
    });

    it('should throw BadRequestException if approving doctor with no credentials uploaded', async () => {
      prismaService.doctor.findUnique.mockResolvedValue({
        ...mockDoctor,
        credentials: [],
      });

      await expect(
        service.approveDoctorCredentialsByFacility(
          facilityUser,
          'doc-uuid-1',
          { approved: true },
          '127.0.0.1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if doctor is already ACTIVE', async () => {
      prismaService.doctor.findUnique.mockResolvedValue({
        ...mockDoctor,
        onboardingStatus: DoctorOnboardingStatus.ACTIVE,
      });

      await expect(
        service.approveDoctorCredentialsByFacility(
          facilityUser,
          'doc-uuid-1',
          { approved: true },
          '127.0.0.1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should handle facility rejection and send notification to doctor', async () => {
      prismaService.doctor.findUnique.mockResolvedValue({
        ...mockDoctor,
        credentials: [{ id: 'cred-1' }],
      });
      prismaService.doctor.update.mockResolvedValue({
        ...mockDoctor,
        onboardingStatus: DoctorOnboardingStatus.PENDING_SUBMISSION,
      });

      const result = await service.approveDoctorCredentialsByFacility(
        facilityUser,
        'doc-uuid-1',
        { approved: false, rejectionReason: 'Giấy tờ mờ' },
        '127.0.0.1',
      );

      expect(result.onboardingStatus).toBe(DoctorOnboardingStatus.PENDING_SUBMISSION);
      expect(prismaService.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: mockDoctor.userId,
          type: 'DOCTOR_FACILITY_REJECTED',
        }),
      });
    });
  });

  describe('approveDoctorCredentialsByPlatform (STT 18 - UC-22)', () => {
    it('should allow ADMIN to approve doctor credentials and activate doctor (ACTIVE)', async () => {
      prismaService.doctor.findUnique.mockResolvedValue({
        ...mockDoctor,
        onboardingStatus: DoctorOnboardingStatus.FACILITY_VERIFIED,
        credentials: [{ id: 'cred-1' }],
      });

      prismaService.doctor.update.mockResolvedValue({
        ...mockDoctor,
        onboardingStatus: DoctorOnboardingStatus.ACTIVE,
      });

      const result = await service.approveDoctorCredentialsByPlatform(
        adminUser,
        'doc-uuid-1',
        { approved: true },
        '127.0.0.1',
      );

      expect(result.onboardingStatus).toBe(DoctorOnboardingStatus.ACTIVE);
      expect(prismaService.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: mockDoctor.userId,
          type: 'DOCTOR_PLATFORM_APPROVED',
        }),
      });
      expect(mailerService.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'doc@famidoc.vn',
        }),
      );
      expect(prismaService.doctorCredential.updateMany).toHaveBeenCalledWith({
        where: { doctorId: 'doc-uuid-1' },
        data: expect.objectContaining({
          platformApproved: true,
          platformApprovedBy: adminUser.id,
        }),
      });
    });

    it('should throw BadRequestException if doctor is not yet FACILITY_VERIFIED', async () => {
      prismaService.doctor.findUnique.mockResolvedValue({
        ...mockDoctor,
        onboardingStatus: DoctorOnboardingStatus.PENDING_SUBMISSION,
      });

      await expect(
        service.approveDoctorCredentialsByPlatform(
          adminUser,
          'doc-uuid-1',
          { approved: true },
          '127.0.0.1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw ForbiddenException if non-admin tries to approve platform tier', async () => {
      await expect(
        service.approveDoctorCredentialsByPlatform(
          facilityUser,
          'doc-uuid-1',
          { approved: true },
          '127.0.0.1',
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should handle platform rejection and send notification to doctor', async () => {
      prismaService.doctor.findUnique.mockResolvedValue({
        ...mockDoctor,
        onboardingStatus: DoctorOnboardingStatus.FACILITY_VERIFIED,
        credentials: [{ id: 'cred-1' }],
      });
      prismaService.doctor.update.mockResolvedValue({
        ...mockDoctor,
        onboardingStatus: DoctorOnboardingStatus.PENDING_SUBMISSION,
      });

      const result = await service.approveDoctorCredentialsByPlatform(
        adminUser,
        'doc-uuid-1',
        { approved: false, rejectionReason: 'Số CCHN không hợp lệ' },
        '127.0.0.1',
      );

      expect(result.onboardingStatus).toBe(DoctorOnboardingStatus.PENDING_SUBMISSION);
      expect(prismaService.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: mockDoctor.userId,
          type: 'DOCTOR_PLATFORM_REJECTED',
        }),
      });
    });
  });
});
