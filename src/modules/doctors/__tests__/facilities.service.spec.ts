import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DoctorsServiceImpl } from '../services/impl/doctors.service.impl';
import type { AuthenticatedUser } from '../../../core/auth/authenticated-request';
import { FacilityVerificationStatus } from '@prisma/client';

describe('Facilities Onboarding Service (2-Stage Verification)', () => {
  let service: DoctorsServiceImpl;
  let prismaService: any;
  let mailerService: any;

  const adminUser: AuthenticatedUser = {
    id: 'admin-uuid-1',
    role: 'ADMIN',
    familyUnitId: null,
  };

  const facilityUser: AuthenticatedUser = {
    id: 'fac-user-uuid-1',
    role: 'HEALTHCARE_FACILITY',
    familyUnitId: null,
  };

  const mockFacility = {
    id: 'fac-uuid-1',
    userId: 'fac-user-uuid-1',
    facilityName: 'Bệnh viện Đa khoa Quốc tế An Sinh',
    licenseNumber: 'PENDING_LICENSE_12345678',
    taxCode: 'PENDING_TAX_12345678',
    address: '123 Giải Phóng, Hà Nội',
    hotline: '0987654321',
    bankName: 'CHƯA_CẬP_NHẬT',
    bankAccountNumber: 'CHƯA_CẬP_NHẬT',
    bankAccountHolder: 'CHƯA_CẬP_NHẬT',
    verificationStatus: FacilityVerificationStatus.PENDING,
    createdAt: new Date(),
    updatedAt: new Date(),
    user: {
      id: 'fac-user-uuid-1',
      email: 'contact@ansinhhospital.vn',
      phone: '0987654321',
      fullName: 'Nguyễn Văn Tuấn',
      role: 'HEALTHCARE_FACILITY',
      status: 'PENDING',
    },
  };

  beforeEach(() => {
    prismaService = {
      $transaction: jest.fn((callback) => callback(prismaService)),
      user: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([{ id: 'admin-1', role: 'ADMIN' }]),
        create: jest.fn().mockResolvedValue({
          id: 'fac-user-uuid-1',
          email: 'contact@ansinhhospital.vn',
          phone: '0987654321',
          fullName: 'Nguyễn Văn Tuấn',
          role: 'HEALTHCARE_FACILITY',
          status: 'PENDING',
        }),
        update: jest.fn().mockResolvedValue({
          id: 'fac-user-uuid-1',
          status: 'ACTIVE',
        }),
      },
      healthcareFacility: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(mockFacility),
        findMany: jest.fn().mockResolvedValue([mockFacility]),
        count: jest.fn().mockResolvedValue(1),
        create: jest.fn().mockResolvedValue(mockFacility),
        update: jest.fn().mockResolvedValue({
          ...mockFacility,
          verificationStatus: FacilityVerificationStatus.ACTIVE,
        }),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({ id: 1n }),
      },
      notification: {
        create: jest.fn().mockResolvedValue({ id: 'notif-1' }),
      },
    };

    mailerService = {
      sendMail: jest.fn().mockResolvedValue(true),
    };

    service = new DoctorsServiceImpl(prismaService, mailerService);
  });

  describe('Stage 1 - Step 1: registerFacility (Public Basic Registration)', () => {
    const regDto = {
      facilityName: 'Bệnh viện Đa khoa Quốc tế An Sinh',
      representativeName: 'Nguyễn Văn Tuấn',
      email: 'contact@ansinhhospital.vn',
      phone: '0987654321',
      address: '123 Giải Phóng, Hà Nội',
    };

    it('should successfully register basic facility info without password and emit notifications', async () => {
      const result = await service.registerFacility(regDto, '127.0.0.1');

      expect(result).toBeDefined();
      expect(result.facilityName).toBe(regDto.facilityName);
      expect(result.verificationStatus).toBe(FacilityVerificationStatus.PENDING);
      expect(prismaService.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: 'contact@ansinhhospital.vn',
            role: 'HEALTHCARE_FACILITY',
            status: 'PENDING',
          }),
        }),
      );
      expect(prismaService.healthcareFacility.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            facilityName: regDto.facilityName,
            verificationStatus: 'PENDING',
          }),
        }),
      );
      expect(prismaService.notification.create).toHaveBeenCalled();
    });

    it('should throw ConflictException if email or phone already exists', async () => {
      prismaService.user.findFirst.mockResolvedValue({ id: 'existing-user' });

      await expect(
        service.registerFacility(regDto, '127.0.0.1'),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw ConflictException if facilityName already exists', async () => {
      prismaService.healthcareFacility.findFirst.mockResolvedValue({
        id: 'existing-fac',
      });

      await expect(
        service.registerFacility(regDto, '127.0.0.1'),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('Stage 1 - Step 2: approveFacilityAccount (Admin Duyệt Lần 1 - Cấp tài khoản)', () => {
    it('should allow Admin to approve account, set user status ACTIVE, and send password email', async () => {
      const result = await service.approveFacilityAccount(
        adminUser,
        'fac-uuid-1',
        { approved: true },
        '127.0.0.1',
      );

      expect(result).toBeDefined();
      expect(prismaService.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'fac-user-uuid-1' },
          data: expect.objectContaining({
            status: 'ACTIVE',
          }),
        }),
      );
      expect(mailerService.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'contact@ansinhhospital.vn',
          subject: expect.stringContaining('Thông báo phê duyệt cấp tài khoản'),
        }),
      );
    });

    it('should allow Admin to reject account with reason', async () => {
      await service.approveFacilityAccount(
        adminUser,
        'fac-uuid-1',
        { approved: false, rejectionReason: 'Cơ sở không có thật' },
        '127.0.0.1',
      );

      expect(prismaService.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'SUSPENDED',
          }),
        }),
      );
      expect(mailerService.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: expect.stringContaining('Thông báo từ chối cấp tài khoản'),
        }),
      );
    });

    it('should throw ForbiddenException if non-admin calls', async () => {
      await expect(
        service.approveFacilityAccount(
          facilityUser,
          'fac-uuid-1',
          { approved: true },
          '127.0.0.1',
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException if facility does not exist', async () => {
      prismaService.healthcareFacility.findUnique.mockResolvedValue(null);

      await expect(
        service.approveFacilityAccount(
          adminUser,
          'non-existing',
          { approved: true },
          '127.0.0.1',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if facility user is already ACTIVE', async () => {
      prismaService.healthcareFacility.findUnique.mockResolvedValue({
        ...mockFacility,
        user: { ...mockFacility.user, status: 'ACTIVE' },
      });

      await expect(
        service.approveFacilityAccount(
          adminUser,
          'fac-uuid-1',
          { approved: true },
          '127.0.0.1',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('Stage 2 - Step 3: submitFacilityLegalProfile (CSYT nộp hồ sơ pháp lý chuyên sâu)', () => {
    const legalDto = {
      licenseNumber: '01293/BYT-GPHĐ',
      taxCode: '0102030405',
      hotline: '19001234',
      bankName: 'Vietcombank',
      bankAccountNumber: '0011002233445',
      bankAccountHolder: 'CONG TY CO PHAN BENH VIEN AN SINH',
      legalDocumentsUrl: 'https://cdn.famidoc.vn/legal.pdf',
    };

    it('should allow CSYT to submit legal & financial profile and set verificationStatus PENDING', async () => {
      const result = await service.submitFacilityLegalProfile(
        facilityUser,
        legalDto,
        '127.0.0.1',
      );

      expect(result).toBeDefined();
      expect(prismaService.healthcareFacility.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            licenseNumber: '01293/BYT-GPHĐ',
            taxCode: '0102030405',
            bankName: 'Vietcombank',
            verificationStatus: 'PENDING',
          }),
        }),
      );
    });

    it('should throw ConflictException if licenseNumber already exists on another facility', async () => {
      prismaService.healthcareFacility.findFirst.mockResolvedValueOnce({
        id: 'other-fac',
        licenseNumber: '01293/BYT-GPHĐ',
      });

      await expect(
        service.submitFacilityLegalProfile(facilityUser, legalDto, '127.0.0.1'),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw ConflictException if taxCode already exists on another facility', async () => {
      prismaService.healthcareFacility.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 'other-fac',
          taxCode: '0102030405',
        });

      await expect(
        service.submitFacilityLegalProfile(facilityUser, legalDto, '127.0.0.1'),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw BadRequestException if facility is already ACTIVE', async () => {
      prismaService.healthcareFacility.findUnique.mockResolvedValue({
        ...mockFacility,
        verificationStatus: FacilityVerificationStatus.ACTIVE,
      });

      await expect(
        service.submitFacilityLegalProfile(facilityUser, legalDto, '127.0.0.1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('Stage 2 - Step 4: verifyFacilityLegal (Admin Duyệt Lần 2 - Hậu kiểm pháp lý)', () => {
    const readyFacility = {
      ...mockFacility,
      licenseNumber: '01293/BYT-GPHĐ',
      taxCode: '0102030405',
      bankName: 'Vietcombank',
      bankAccountNumber: '0011002233445',
      bankAccountHolder: 'CONG TY AN SINH',
      verificationStatus: FacilityVerificationStatus.PENDING,
    };

    it('should allow Admin to verify legal profile and activate facility (ACTIVE)', async () => {
      prismaService.healthcareFacility.findUnique.mockResolvedValue(readyFacility);

      const result = await service.verifyFacilityLegal(
        adminUser,
        'fac-uuid-1',
        { approved: true },
        '127.0.0.1',
      );

      expect(result).toBeDefined();
      expect(prismaService.healthcareFacility.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            verificationStatus: 'ACTIVE',
          }),
        }),
      );
      expect(mailerService.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: expect.stringContaining('đã được kích hoạt thành công'),
        }),
      );
    });

    it('should throw BadRequestException if facility has not submitted legal profile yet (still PENDING placeholders)', async () => {
      prismaService.healthcareFacility.findUnique.mockResolvedValue(mockFacility); // licenseNumber: PENDING_LICENSE_...

      await expect(
        service.verifyFacilityLegal(
          adminUser,
          'fac-uuid-1',
          { approved: true },
          '127.0.0.1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if facility is already ACTIVE', async () => {
      prismaService.healthcareFacility.findUnique.mockResolvedValue({
        ...readyFacility,
        verificationStatus: FacilityVerificationStatus.ACTIVE,
      });

      await expect(
        service.verifyFacilityLegal(
          adminUser,
          'fac-uuid-1',
          { approved: true },
          '127.0.0.1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw ForbiddenException if non-admin calls', async () => {
      await expect(
        service.verifyFacilityLegal(
          facilityUser,
          'fac-uuid-1',
          { approved: true },
          '127.0.0.1',
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
