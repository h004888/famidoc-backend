import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  ValidationPipe,
} from '@nestjs/common';
import { DoctorsServiceImpl } from '../services/impl/doctors.service.impl';
import { ProvisionDoctorDto } from '../dtos/provision-doctor.dto';
import { PrismaService } from '../../../core/database/prisma.service';
import { StorageService } from '../../../core/services/storage.service';
import type { AuthenticatedUser } from '../../../core/auth/authenticated-request';
import { DoctorCredentialType, DoctorOnboardingStatus } from '@prisma/client';
import ExcelJS from 'exceljs';

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
        findMany: jest.fn().mockResolvedValue([mockDoctor]),
        count: jest.fn().mockResolvedValue(1),
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
        {
          provide: StorageService,
          useValue: {
            uploadFile: jest.fn(),
            downloadFile: jest.fn(),
          },
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

    it('should throw ForbiddenException if ADMIN attempts to provision doctor', async () => {
      await expect(
        service.provisionDoctorAccount(adminUser, dto, '127.0.0.1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should allow HEALTHCARE_FACILITY to provision doctor for its own facility', async () => {
      const { facilityId: _, ...facilityDto } = dto;

      const result = await service.provisionDoctorAccount(
        facilityUser,
        facilityDto,
        '127.0.0.1',
      );

      expect(result).toBeDefined();
      expect(result.doctorName).toBe('BS. CKI Nguyễn Văn An');
      expect((result as any).initialPassword).toBeUndefined();
      expect(result.onboardingStatus).toBe(
        DoctorOnboardingStatus.PENDING_SUBMISSION,
      );
      expect(prismaService.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            role: 'DOCTOR',
            status: 'PENDING',
            mustChangePassword: true,
          }),
        }),
      );
      expect(prismaService.doctor.create).toHaveBeenCalled();
      expect(prismaService.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'DOCTOR_ACCOUNT_PROVISIONED',
          resourceName: 'Doctor',
        }),
      });
      expect(prismaService.healthcareFacility.findUnique).toHaveBeenCalledWith({
        where: { userId: facilityUser.id },
      });
    });

    it('should throw BadRequestException if facility has no active B2B staffing contract', async () => {
      prismaService.b2bStaffingContract.findFirst.mockResolvedValue(null);

      await expect(
        service.provisionDoctorAccount(facilityUser, dto, '127.0.0.1'),
      ).rejects.toThrow(
        new BadRequestException(
          'Cơ sở y tế chưa có hợp đồng nhân lực B2B đang có hiệu lực',
        ),
      );
    });

    it('should evaluate B2B contract startDate <= today <= endDate using Vietnam timezone', async () => {
      jest.useFakeTimers();
      try {
        // 2026-11-17T18:30:00.000Z === 2026-11-18 01:30:00 UTC+7
        jest.setSystemTime(new Date('2026-11-17T18:30:00.000Z'));

        await service.provisionDoctorAccount(facilityUser, dto, '127.0.0.1');

        expect(prismaService.b2bStaffingContract.findFirst).toHaveBeenCalledWith({
          where: {
            facilityId: 'fac-uuid-1',
            status: 'ACTIVE',
            startDate: { lte: new Date('2026-11-18T00:00:00.000Z') },
            endDate: { gte: new Date('2026-11-18T00:00:00.000Z') },
          },
        });
      } finally {
        jest.useRealTimers();
      }
    });

    it('should send welcome email when doctor is provisioned and return mailSent=true with email/phone', async () => {
      const result = await service.provisionDoctorAccount(
        facilityUser,
        dto,
        '127.0.0.1',
      );

      expect(result.email).toBe(dto.email);
      expect(result.phone).toBe(dto.phone);
      expect(result.mailSent).toBe(true);
      expect(result.mailWarning).toBeUndefined();
      expect(mailerService.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: dto.email,
        }),
      );
    });

    it('should preserve doctor account and return mailSent=false with mailWarning when provisioning email fails', async () => {
      mailerService.sendMail.mockRejectedValueOnce(new Error('SMTP down'));

      const result = await service.provisionDoctorAccount(
        facilityUser,
        dto,
        '127.0.0.1',
      );

      expect(result.email).toBe(dto.email);
      expect(result.phone).toBe(dto.phone);
      expect(result.mailSent).toBe(false);
      expect(result.mailWarning).toBeTruthy();
    });

    it('should throw ConflictException if email or phone already exists', async () => {
      prismaService.user.findFirst.mockResolvedValue({ id: 'existing-user' });

      await expect(
        service.provisionDoctorAccount(facilityUser, dto, '127.0.0.1'),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw BadRequestException if facility does not exist', async () => {
      prismaService.healthcareFacility.findUnique.mockResolvedValue(null);

      await expect(
        service.provisionDoctorAccount(facilityUser, dto, '127.0.0.1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should normalize +84/84 phone on ProvisionDoctorDto and reject invalid 0|... or 8484...', async () => {
      const { facilityId: _, ...baseDto } = dto;
      const pipe = new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      });

      const normalized = await pipe.transform(
        { ...baseDto, phone: '+84 912 345 678' },
        { type: 'body', metatype: ProvisionDoctorDto },
      );
      expect(normalized.phone).toBe('0912345678');

      await expect(
        pipe.transform(
          { ...baseDto, phone: '0|12345678' },
          { type: 'body', metatype: ProvisionDoctorDto },
        ),
      ).rejects.toMatchObject({ status: 400 });

      await expect(
        pipe.transform(
          { ...baseDto, phone: '8484912345678' },
          { type: 'body', metatype: ProvisionDoctorDto },
        ),
      ).rejects.toMatchObject({ status: 400 });

      await service.provisionDoctorAccount(
        facilityUser,
        { ...baseDto, phone: '84912345678' },
        '127.0.0.1',
      );
      expect(prismaService.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            phone: '0912345678',
          }),
        }),
      );
    });
  });

  describe('submitDoctorCredentials (STT 16 - UC-21)', () => {
    const pdfFile = {
      fieldname: 'file',
      originalname: 'doc.pdf',
      encoding: '7bit',
      mimetype: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\n%valid-content'),
      size: 24,
    } as Express.Multer.File;

    const uploadedThreeFiles = {
      cchnFile: [pdfFile],
      degreeFile: [pdfFile],
      familyMedicineFile: [pdfFile],
    };

    const credDto = {
      academicTitle: 'ThS. BS.CKI',
      specialty: 'Y học gia đình',
      experienceYears: 9,
      bio: 'Bác sĩ y học gia đình tận tâm.',
      credentials: [
        {
          credentialType: DoctorCredentialType.PRACTICE_LICENSE_CCHN,
          certificateNumber: 'CCHN-123',
          issueDate: '2020-01-01',
          issuingAuthority: 'Bộ Y tế',
        },
        {
          credentialType: DoctorCredentialType.DEGREE,
          certificateNumber: 'DEG-456',
          issueDate: '2018-06-15',
          issuingAuthority: 'Đại học Y Hà Nội',
        },
        {
          credentialType: DoctorCredentialType.FAMILY_MEDICINE_CERT,
          certificateNumber: 'FM-789',
          issueDate: '2021-03-10',
          issuingAuthority: 'Trường ĐH Y Dược TP.HCM',
        },
      ],
    };

    beforeEach(() => {
      const storage = (service as any).storage;
      storage.uploadFile = jest.fn().mockResolvedValue('doctor-credentials/doc-uuid-1/test.pdf');
      prismaService.doctor.update.mockResolvedValue({
        ...mockDoctor,
        onboardingStatus: DoctorOnboardingStatus.PENDING_FACILITY_REVIEW,
        academicTitle: 'ThS. BS.CKI',
      });
    });

    it('should allow doctor to upload 3 real files, update profile, and transition to PENDING_FACILITY_REVIEW', async () => {
      const result = await service.submitDoctorCredentials(
        doctorUser,
        'doc-uuid-1',
        credDto,
        '127.0.0.1',
        uploadedThreeFiles,
      );

      expect(result).toBeDefined();
      expect(result.onboardingStatus).toBe(
        DoctorOnboardingStatus.PENDING_FACILITY_REVIEW,
      );
      expect(prismaService.doctor.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            onboardingStatus: 'PENDING_FACILITY_REVIEW',
            rejectionReason: null,
            academicTitle: 'ThS. BS.CKI',
            experienceYears: 9,
          }),
        }),
      );
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

    it('should reject submission when any of the 3 mandatory document types is missing', async () => {
      await expect(
        service.submitDoctorCredentials(
          doctorUser,
          'doc-uuid-1',
          { credentials: [credDto.credentials[0]] },
          '127.0.0.1',
          { cchnFile: [pdfFile] },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject submission when uploaded file has spoofed/invalid magic bytes', async () => {
      const badFile = {
        ...pdfFile,
        buffer: Buffer.from('NOT_A_REAL_PDF'),
      } as Express.Multer.File;
      await expect(
        service.submitDoctorCredentials(
          doctorUser,
          'doc-uuid-1',
          credDto,
          '127.0.0.1',
          {
            cchnFile: [badFile],
            degreeFile: [pdfFile],
            familyMedicineFile: [pdfFile],
          },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should allow doctor to upload credentials using "me" alias', async () => {
      prismaService.doctor.findFirst = jest.fn().mockResolvedValue(mockDoctor);

      const result = await service.submitDoctorCredentials(
        doctorUser,
        'me',
        credDto,
        '127.0.0.1',
        uploadedThreeFiles,
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
          uploadedThreeFiles,
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
          uploadedThreeFiles,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if doctor is FACILITY_VERIFIED or SUSPENDED', async () => {
      prismaService.doctor.findUnique.mockResolvedValueOnce({
        ...mockDoctor,
        onboardingStatus: DoctorOnboardingStatus.FACILITY_VERIFIED,
      });

      await expect(
        service.submitDoctorCredentials(
          doctorUser,
          'doc-uuid-1',
          credDto,
          '127.0.0.1',
          uploadedThreeFiles,
        ),
      ).rejects.toThrow(BadRequestException);

      prismaService.doctor.findUnique.mockResolvedValueOnce({
        ...mockDoctor,
        onboardingStatus: DoctorOnboardingStatus.SUSPENDED,
      });

      await expect(
        service.submitDoctorCredentials(
          doctorUser,
          'doc-uuid-1',
          credDto,
          '127.0.0.1',
          uploadedThreeFiles,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw ConflictException when doctor is already PENDING_FACILITY_REVIEW', async () => {
      prismaService.doctor.findUnique.mockResolvedValueOnce({
        ...mockDoctor,
        onboardingStatus: DoctorOnboardingStatus.PENDING_FACILITY_REVIEW,
      });

      await expect(
        service.submitDoctorCredentials(
          doctorUser,
          'doc-uuid-1',
          credDto,
          '127.0.0.1',
          uploadedThreeFiles,
        ),
      ).rejects.toThrow(ConflictException);
      expect(prismaService.$transaction).not.toHaveBeenCalled();
    });

    it('should allow resubmission when doctor is PENDING_SUBMISSION with rejectionReason', async () => {
      prismaService.doctor.findUnique.mockResolvedValueOnce({
        ...mockDoctor,
        onboardingStatus: DoctorOnboardingStatus.PENDING_SUBMISSION,
        rejectionReason: 'Ảnh CCHN bị mờ góc',
      });

      const result = await service.submitDoctorCredentials(
        doctorUser,
        'doc-uuid-1',
        credDto,
        '127.0.0.1',
        uploadedThreeFiles,
      );

      expect(result.onboardingStatus).toBe(
        DoctorOnboardingStatus.PENDING_FACILITY_REVIEW,
      );
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
          credDto.credentials[1],
          credDto.credentials[2],
        ],
      };

      await expect(
        service.submitDoctorCredentials(
          doctorUser,
          'doc-uuid-1',
          futureDateDto,
          '127.0.0.1',
          uploadedThreeFiles,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should accept today issueDate in Vietnam timezone during 00:00–06:59 UTC+7', async () => {
      prismaService.doctor.findUnique.mockResolvedValue({
        ...mockDoctor,
        onboardingStatus: DoctorOnboardingStatus.PENDING_SUBMISSION,
      });

      jest.useFakeTimers();
      try {
        // 2026-11-17T18:30:00.000Z === 2026-11-18 01:30:00 UTC+7
        jest.setSystemTime(new Date('2026-11-17T18:30:00.000Z'));

        const todayVnDto = {
          credentials: [
            {
              ...credDto.credentials[0],
              issueDate: '2026-11-18',
            },
            credDto.credentials[1],
            credDto.credentials[2],
          ],
        };

        const result = await service.submitDoctorCredentials(
          doctorUser,
          'doc-uuid-1',
          todayVnDto,
          '127.0.0.1',
          uploadedThreeFiles,
        );
        expect(result).toBeDefined();

        const tomorrowVnDto = {
          credentials: [
            {
              ...credDto.credentials[0],
              issueDate: '2026-11-19',
            },
            credDto.credentials[1],
            credDto.credentials[2],
          ],
        };

        await expect(
          service.submitDoctorCredentials(
            doctorUser,
            'doc-uuid-1',
            tomorrowVnDto,
            '127.0.0.1',
            uploadedThreeFiles,
          ),
        ).rejects.toThrow(BadRequestException);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('approveDoctorCredentialsByFacility (STT 17 - UC-22)', () => {
    const threeValidCreds = [
      { id: 'cred-1', credentialType: DoctorCredentialType.PRACTICE_LICENSE_CCHN },
      { id: 'cred-2', credentialType: DoctorCredentialType.DEGREE },
      { id: 'cred-3', credentialType: DoctorCredentialType.FAMILY_MEDICINE_CERT },
    ];

    it('should approve doctor credentials and update status to FACILITY_VERIFIED', async () => {
      prismaService.doctor.findUnique.mockResolvedValue({
        ...mockDoctor,
        onboardingStatus: DoctorOnboardingStatus.PENDING_FACILITY_REVIEW,
        credentials: threeValidCreds,
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

    it('should throw BadRequestException if approving doctor with incomplete or missing credentials', async () => {
      prismaService.doctor.findUnique.mockResolvedValueOnce({
        ...mockDoctor,
        onboardingStatus: DoctorOnboardingStatus.PENDING_FACILITY_REVIEW,
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

      prismaService.doctor.findUnique.mockResolvedValueOnce({
        ...mockDoctor,
        onboardingStatus: DoctorOnboardingStatus.PENDING_FACILITY_REVIEW,
        credentials: [threeValidCreds[0]],
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

    it('should throw BadRequestException if doctor is not PENDING_FACILITY_REVIEW or is already ACTIVE', async () => {
      prismaService.doctor.findUnique.mockResolvedValueOnce({
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

      prismaService.doctor.findUnique.mockResolvedValueOnce({
        ...mockDoctor,
        onboardingStatus: DoctorOnboardingStatus.FACILITY_VERIFIED,
        credentials: threeValidCreds,
      });

      await expect(
        service.approveDoctorCredentialsByFacility(
          facilityUser,
          'doc-uuid-1',
          { approved: false, rejectionReason: 'Không hợp lệ' },
          '127.0.0.1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should handle facility rejection and send notification to doctor', async () => {
      prismaService.doctor.findUnique.mockResolvedValue({
        ...mockDoctor,
        onboardingStatus: DoctorOnboardingStatus.PENDING_FACILITY_REVIEW,
        credentials: threeValidCreds,
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

    it('should throw BadRequestException if facility rejects without rejectionReason', async () => {
      prismaService.doctor.findUnique.mockResolvedValue({
        ...mockDoctor,
        onboardingStatus: DoctorOnboardingStatus.PENDING_FACILITY_REVIEW,
        credentials: threeValidCreds,
      });

      await expect(
        service.approveDoctorCredentialsByFacility(
          facilityUser,
          'doc-uuid-1',
          { approved: false },
          '127.0.0.1',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('approveDoctorCredentialsByPlatform (STT 18 - UC-22)', () => {
    it('should allow ADMIN to approve doctor credentials, activate user+doctor, and notify+email both Doctor and Facility', async () => {
      prismaService.user.findUnique
        .mockResolvedValueOnce({ id: mockDoctor.userId, email: 'doc@famidoc.vn' })
        .mockResolvedValueOnce({
          id: mockFacility.userId,
          email: 'facility@hoanmy.vn',
        });
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
      expect(prismaService.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: mockFacility.userId,
          type: 'DOCTOR_ONBOARDING_COMPLETED',
        }),
      });
      expect(mailerService.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'doc@famidoc.vn',
        }),
      );
      expect(mailerService.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'facility@hoanmy.vn',
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

    it('sends platform review emails only after DB transaction commits and does not fail approval when mailer throws', async () => {
      const callOrder: string[] = [];
      prismaService.$transaction.mockImplementationOnce(async (cb: any) => {
        const res = await cb(prismaService);
        callOrder.push('tx-committed');
        return res;
      });
      prismaService.doctor.findUnique.mockResolvedValue({
        ...mockDoctor,
        onboardingStatus: DoctorOnboardingStatus.FACILITY_VERIFIED,
        credentials: [{ id: 'cred-1' }],
      });
      prismaService.doctor.update.mockResolvedValue({
        ...mockDoctor,
        onboardingStatus: DoctorOnboardingStatus.ACTIVE,
      });
      prismaService.user.findUnique
        .mockResolvedValueOnce({ id: mockDoctor.userId, email: 'doc@famidoc.vn' })
        .mockResolvedValueOnce({ id: mockFacility.userId, email: 'facility@hoanmy.vn' });
      mailerService.sendMail.mockImplementationOnce(async () => {
        callOrder.push('sendMail');
        throw new Error('SMTP down');
      });

      const result = await service.approveDoctorCredentialsByPlatform(
        adminUser,
        'doc-uuid-1',
        { approved: true },
        '127.0.0.1',
      );

      expect(result.onboardingStatus).toBe(DoctorOnboardingStatus.ACTIVE);
      expect(callOrder).toEqual(['tx-committed', 'sendMail']);
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

    it('should handle platform rejection and send notification and email to both doctor and facility', async () => {
      prismaService.user.findUnique
        .mockResolvedValueOnce({ id: mockDoctor.userId, email: 'doc@famidoc.vn' })
        .mockResolvedValueOnce({
          id: mockFacility.userId,
          email: 'facility@hoanmy.vn',
        });
      prismaService.doctor.findUnique.mockResolvedValue({
        ...mockDoctor,
        onboardingStatus: DoctorOnboardingStatus.FACILITY_VERIFIED,
        credentials: [{ id: 'cred-1' }],
      });
      prismaService.doctor.update.mockResolvedValue({
        ...mockDoctor,
        onboardingStatus: DoctorOnboardingStatus.PENDING_SUBMISSION,
        rejectionReason: 'Số CCHN không hợp lệ',
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
      expect(prismaService.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: mockFacility.userId,
          type: 'DOCTOR_PLATFORM_REJECTED',
        }),
      });
      expect(mailerService.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'doc@famidoc.vn',
          text: expect.stringContaining('Số CCHN không hợp lệ'),
        }),
      );
      expect(mailerService.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'facility@hoanmy.vn',
          text: expect.stringContaining('Số CCHN không hợp lệ'),
        }),
      );
    });

    it('should throw BadRequestException if platform rejects without rejectionReason', async () => {
      prismaService.doctor.findUnique.mockResolvedValue({
        ...mockDoctor,
        onboardingStatus: DoctorOnboardingStatus.FACILITY_VERIFIED,
      });

      await expect(
        service.approveDoctorCredentialsByPlatform(
          adminUser,
          'doc-uuid-1',
          { approved: false },
          '127.0.0.1',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getDoctorProfile, listDoctors & listFacilityDoctors', () => {
    it('should get doctor profile by ID', async () => {
      prismaService.doctor.findUnique.mockResolvedValue(mockDoctor);

      const result = await service.getDoctorProfile(adminUser, 'doc-uuid-1');

      expect(result).toBeDefined();
      expect(result.id).toBe('doc-uuid-1');
    });

    it('should get own doctor profile when ID is me', async () => {
      prismaService.doctor.findUnique.mockResolvedValue(mockDoctor);

      const result = await service.getDoctorProfile(doctorUser, 'me');

      expect(result).toBeDefined();
      expect(prismaService.doctor.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: doctorUser.id },
        }),
      );
    });

    it('should throw ForbiddenException if facility tries to view another facility doctor', async () => {
      prismaService.doctor.findUnique.mockResolvedValue({
        ...mockDoctor,
        facility: { id: 'other-fac', userId: 'other-user' },
      });

      await expect(
        service.getDoctorProfile(facilityUser, 'doc-uuid-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should allow ADMIN to list doctors with query filters', async () => {
      prismaService.doctor.count.mockResolvedValue(1);
      prismaService.doctor.findMany.mockResolvedValue([mockDoctor]);

      const result = await service.listDoctors(adminUser, {
        onboardingStatus: DoctorOnboardingStatus.FACILITY_VERIFIED,
        page: 1,
        limit: 10,
      });

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(prismaService.doctor.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            onboardingStatus: DoctorOnboardingStatus.FACILITY_VERIFIED,
          }),
        }),
      );
    });

    it('should allow HEALTHCARE_FACILITY to list doctors scoped to its facility and include user email/phone', async () => {
      prismaService.healthcareFacility.findUnique.mockResolvedValue(mockFacility);
      prismaService.doctor.count.mockResolvedValue(1);
      prismaService.doctor.findMany.mockResolvedValue([
        {
          ...mockDoctor,
          user: { email: 'bs.an@famidoc.vn', phone: '0912345678' },
        },
      ]);

      const result = await service.listFacilityDoctors(facilityUser, {
        page: 1,
        limit: 10,
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].email).toBe('bs.an@famidoc.vn');
      expect(result.items[0].phone).toBe('0912345678');
      expect(prismaService.doctor.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            facilityId: mockFacility.id,
          }),
          include: expect.objectContaining({
            user: { select: { email: true, phone: true } },
          }),
        }),
      );
    });
  });

  describe('Bulk Excel Doctor Import (generateTemplate, preview, confirm)', () => {
    async function makeExcelFile(
      rows: Array<Array<string | number>>,
    ): Promise<Express.Multer.File> {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Danh sách bác sĩ');
      ws.addRow([
        'Họ và tên (*)',
        'Email (*)',
        'Số điện thoại (*)',
        'Chuyên khoa',
        'Học hàm / Học vị',
        'Số năm kinh nghiệm',
        'Tiểu sử chuyên môn',
      ]);
      for (const r of rows) {
        ws.addRow(r);
      }
      const raw = await wb.xlsx.writeBuffer();
      const buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      return {
        fieldname: 'file',
        originalname: 'doctors.xlsx',
        encoding: '7bit',
        mimetype:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        buffer,
        size: buffer.length,
      } as Express.Multer.File;
    }

    it('rejects template download when facility has no active B2B contract', async () => {
      prismaService.b2bStaffingContract.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.generateDoctorImportTemplate(facilityUser),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects preview and confirm when facility has no active B2B contract', async () => {
      const file = await makeExcelFile([
        ['BS Mới 1', 'new1@hospital.vn', '0911111111', '', '', '', ''],
      ]);

      prismaService.b2bStaffingContract.findFirst.mockResolvedValueOnce(null);
      await expect(
        service.previewDoctorsExcelImport(facilityUser, file),
      ).rejects.toThrow(BadRequestException);

      prismaService.b2bStaffingContract.findFirst.mockResolvedValueOnce(null);
      await expect(
        service.confirmDoctorsBulkImport(
          facilityUser,
          {
            doctors: [
              {
                rowNumber: 2,
                doctorName: 'BS Mới 1',
                email: 'new1@hospital.vn',
                phone: '0911111111',
              },
            ],
          },
          '127.0.0.1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('generates Excel template for active facility with active B2B contract', async () => {
      const buf = await service.generateDoctorImportTemplate(facilityUser);
      expect(Buffer.isBuffer(buf)).toBe(true);
      expect(buf[0]).toBe(0x50);
      expect(buf[1]).toBe(0x4b);
    });

    it('classifies preview rows into NEW_VALID, EXISTING_SKIPPED, and INVALID (internal dup + partial conflict + other facility)', async () => {
      const file = await makeExcelFile([
        ['BS Mới 1', 'new1@hospital.vn', '0911111111', 'Khoa Nhi', 'BS', 3, ''],
        ['BS Cũ Đợt 1', 'old@hospital.vn', '0922222222', '', '', '', ''],
        ['BS Trùng Trong File', 'new1@hospital.vn', '0933333333', '', '', '', ''],
        ['BS Nhầm SĐT Cũ', 'wrongphone@hospital.vn', '0922222222', '', '', '', ''],
        ['BS CSYT Khác', 'otherfac@hospital.vn', '0944444444', '', '', '', ''],
        ['X', 'bad-email', '123', '', '', '', ''],
      ]);

      prismaService.user.findMany.mockResolvedValueOnce([
        {
          id: 'u-old',
          email: 'old@hospital.vn',
          phone: '0922222222',
          fullName: 'BS Cũ Đợt 1',
          role: 'DOCTOR',
          doctor: {
            id: 'doc-old',
            facilityId: mockFacility.id,
            doctorName: 'BS Cũ Đợt 1',
            onboardingStatus: DoctorOnboardingStatus.PENDING_SUBMISSION,
          },
        },
        {
          id: 'u-other',
          email: 'otherfac@hospital.vn',
          phone: '0944444444',
          fullName: 'BS CSYT Khác',
          role: 'DOCTOR',
          doctor: {
            id: 'doc-other',
            facilityId: 'other-facility-uuid',
            doctorName: 'BS CSYT Khác',
            onboardingStatus: DoctorOnboardingStatus.ACTIVE,
          },
        },
      ]);

      const preview = await service.previewDoctorsExcelImport(facilityUser, file);

      expect(preview.summary.totalReadRows).toBe(6);
      expect(preview.summary.validCount).toBe(1);
      expect(preview.summary.existingSkippedCount).toBe(1);
      expect(preview.summary.invalidCount).toBe(4);

      expect(preview.validRows[0]).toMatchObject({
        rowNumber: 2,
        email: 'new1@hospital.vn',
        phone: '0911111111',
      });
      expect(preview.existingRows[0]).toMatchObject({
        rowNumber: 3,
        existingDoctorId: 'doc-old',
      });
      expect(preview.invalidRows.map((r) => r.rowNumber)).toEqual([4, 5, 6, 7]);
    });

    it('rejects confirm batch exceeding 30 new doctors', async () => {
      const tooMany = Array.from({ length: 31 }, (_, i) => ({
        rowNumber: i + 2,
        doctorName: `BS ${i + 1}`,
        email: `doc${i + 1}@hospital.vn`,
        phone: `0912345${String(i).padStart(3, '0')}`,
      }));

      await expect(
        service.confirmDoctorsBulkImport(
          facilityUser,
          { doctors: tooMany },
          '127.0.0.1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates valid doctors independently and preserves created accounts even when mail fails for one doctor', async () => {
      prismaService.user.findMany.mockResolvedValueOnce([
        { email: 'taken@hospital.vn', phone: '0999999999' },
      ]);

      mailerService.sendMail
        .mockResolvedValueOnce({ messageId: 'ok-1' })
        .mockRejectedValueOnce(new Error('SMTP timeout'));

      const result = await service.confirmDoctorsBulkImport(
        facilityUser,
        {
          doctors: [
            {
              rowNumber: 2,
              doctorName: 'BS Thành Công 1',
              email: 'ok1@hospital.vn',
              phone: '0911111111',
            },
            {
              rowNumber: 3,
              doctorName: 'BS Trùng Trước Lúc Confirm',
              email: 'taken@hospital.vn',
              phone: '0999999999',
            },
            {
              rowNumber: 4,
              doctorName: 'BS Thành Công Mail Lỗi',
              email: 'ok2@hospital.vn',
              phone: '0922222222',
            },
          ],
        },
        '127.0.0.1',
      );

      expect(result.summary).toEqual({
        requestedCount: 3,
        createdCount: 2,
        failedCount: 1,
        mailSentCount: 1,
        mailFailedCount: 1,
      });
      expect(result.createdDoctors).toHaveLength(2);
      expect(result.createdDoctors[0].mailSent).toBe(true);
      expect(result.createdDoctors[1].mailSent).toBe(false);
      expect(result.createdDoctors[1].mailWarning).toBeDefined();
      expect(result.failedRows).toHaveLength(1);
      expect(result.failedRows[0].email).toBe('taken@hospital.vn');
    });

    it('matches legacy 84/+84 DB phones and uppercase DB emails in preview and confirm', async () => {
      const file = await makeExcelFile([
        ['BS Cũ Legacy 84', 'legacy@hospital.vn', '0912345678', '', '', '', ''],
      ]);

      prismaService.user.findMany.mockResolvedValueOnce([
        {
          id: 'u-legacy',
          email: 'LEGACY@HOSPITAL.VN',
          phone: '84912345678',
          fullName: 'BS Cũ Legacy 84',
          role: 'DOCTOR',
          doctor: {
            id: 'doc-legacy',
            facilityId: mockFacility.id,
            doctorName: 'BS Cũ Legacy 84',
            onboardingStatus: DoctorOnboardingStatus.ACTIVE,
          },
        },
      ]);

      const preview = await service.previewDoctorsExcelImport(facilityUser, file);
      expect(preview.summary.existingSkippedCount).toBe(1);
      expect(preview.summary.validCount).toBe(0);
      expect(preview.existingRows[0].existingDoctorId).toBe('doc-legacy');
      expect(prismaService.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: expect.arrayContaining([
              { email: { equals: 'legacy@hospital.vn', mode: 'insensitive' } },
              {
                phone: {
                  in: expect.arrayContaining(['0912345678', '84912345678', '+84912345678']),
                },
              },
            ]),
          },
        }),
      );

      prismaService.user.findMany.mockResolvedValueOnce([
        { email: 'LEGACY@HOSPITAL.VN', phone: '+84912345678' },
      ]);
      const confirm = await service.confirmDoctorsBulkImport(
        facilityUser,
        {
          doctors: [
            {
              rowNumber: 2,
              doctorName: 'BS Cũ Legacy 84',
              email: 'other@hospital.vn',
              phone: '0912345678',
            },
          ],
        },
        '127.0.0.1',
      );
      expect(confirm.summary.createdCount).toBe(0);
      expect(confirm.summary.failedCount).toBe(1);
    });
  });
});
