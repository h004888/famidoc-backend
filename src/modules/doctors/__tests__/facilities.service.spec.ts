import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  ValidationPipe,
} from '@nestjs/common';
import { DoctorsServiceImpl } from '../services/impl/doctors.service.impl';
import { CreateFacilityDto } from '../dtos/create-facility.dto';
import { SubmitFacilityLegalProfileDto } from '../dtos/submit-facility-legal-profile.dto';
import type { AuthenticatedUser } from '../../../core/auth/authenticated-request';
import { FacilityVerificationStatus, UserStatus } from '@prisma/client';

describe('Facilities Onboarding Service (Admin-Led Provisioning & Legal Verification)', () => {
  let service: DoctorsServiceImpl;
  let prismaService: any;
  let mailerService: any;
  let storageService: any;

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
    bankBin: null,
    bankCode: null,
    bankAccountNumber: 'CHƯA_CẬP_NHẬT',
    bankAccountHolder: 'CHƯA_CẬP_NHẬT',
    legalDocumentKey: null,
    businessLicenseKey: null,
    legalRejectionReason: null,
    verificationStatus: FacilityVerificationStatus.PENDING,
    createdAt: new Date(),
    updatedAt: new Date(),
    user: {
      id: 'fac-user-uuid-1',
      email: 'contact@ansinhhospital.vn',
      phone: '0987654321',
      fullName: 'Nguyễn Văn Tuấn',
      role: 'HEALTHCARE_FACILITY',
      status: UserStatus.ACTIVE,
      mustChangePassword: true,
    },
  };

  const validPdfFile = {
    buffer: Buffer.from('%PDF-1.7\nlegal-scan-data'),
    size: 25,
    originalname: 'gphd.pdf',
    mimetype: 'application/pdf',
  } as Express.Multer.File;

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
          status: 'ACTIVE',
          mustChangePassword: true,
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
      b2bStaffingContract: {
        findFirst: jest.fn().mockResolvedValue(null),
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

    storageService = {
      uploadFile: jest.fn().mockResolvedValue('facility-legal/fac-uuid-1/license.pdf'),
      downloadFile: jest.fn(),
    };

    service = new DoctorsServiceImpl(prismaService, mailerService, storageService);
  });

  describe('Step 1: createFacilityByAdmin', () => {
    const createDto = {
      facilityName: 'Bệnh viện Đa khoa Quốc tế An Sinh',
      representativeName: 'Nguyễn Văn Tuấn',
      email: 'contact@ansinhhospital.vn',
      phone: '0987654321',
      address: '123 Giải Phóng, Hà Nội',
    };

    it('creates ACTIVE facility user with mustChangePassword=true, random password, PENDING verification, and sends email', async () => {
      const result = await service.createFacilityByAdmin(
        adminUser,
        createDto,
        '127.0.0.1',
      );

      expect(result).toBeDefined();
      expect(result.verificationStatus).toBe(FacilityVerificationStatus.PENDING);
      expect(prismaService.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: 'contact@ansinhhospital.vn',
            role: 'HEALTHCARE_FACILITY',
            status: 'ACTIVE',
            mustChangePassword: true,
          }),
        }),
      );
      expect(mailerService.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'contact@ansinhhospital.vn',
          text: expect.stringContaining('Fd!'),
        }),
      );
      expect(prismaService.notification.create).toHaveBeenCalled();
    });

    it('rejects non-admin callers with ForbiddenException', async () => {
      await expect(
        service.createFacilityByAdmin(facilityUser, createDto, '127.0.0.1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ConflictException if email or phone already exists', async () => {
      prismaService.user.findFirst.mockResolvedValue({ id: 'existing-user' });

      await expect(
        service.createFacilityByAdmin(adminUser, createDto, '127.0.0.1'),
      ).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException if facilityName already exists', async () => {
      prismaService.healthcareFacility.findFirst.mockResolvedValue({
        id: 'existing-fac',
      });

      await expect(
        service.createFacilityByAdmin(adminUser, createDto, '127.0.0.1'),
      ).rejects.toThrow(ConflictException);
    });

    it('normalizes +84 and 84 Vietnamese mobile phones and rejects invalid patterns like 0|... or 8484...', async () => {
      const pipe = new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      });

      const plus84Dto = await pipe.transform(
        { ...createDto, phone: '+84 987 654 321' },
        { type: 'body', metatype: CreateFacilityDto },
      );
      expect(plus84Dto.phone).toBe('0987654321');

      const prefix84Dto = await pipe.transform(
        { ...createDto, phone: '84912345678' },
        { type: 'body', metatype: CreateFacilityDto },
      );
      expect(prefix84Dto.phone).toBe('0912345678');

      await expect(
        pipe.transform(
          { ...createDto, phone: '0|12345678' },
          { type: 'body', metatype: CreateFacilityDto },
        ),
      ).rejects.toMatchObject({ status: 400 });

      await expect(
        pipe.transform(
          { ...createDto, phone: '8484987654321' },
          { type: 'body', metatype: CreateFacilityDto },
        ),
      ).rejects.toMatchObject({ status: 400 });

      await service.createFacilityByAdmin(
        adminUser,
        { ...createDto, phone: '+84987654321' },
        '127.0.0.1',
      );
      expect(prismaService.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            phone: '0987654321',
          }),
        }),
      );
    });
  });

  describe('Step 2: submitFacilityLegalProfile', () => {
    const legalDto: SubmitFacilityLegalProfileDto = {
      licenseNumber: '01293/BYT-GPHĐ',
      licenseIssuer: 'Bộ Y tế - Cục Quản lý Khám chữa bệnh',
      licenseDate: '2024-05-15',
      taxCode: '0102030405',
      address: '123 Giải Phóng, Phường Đồng Tâm, Quận Hai Bà Trưng, Hà Nội',
      hotline: '19001234',
      bankName: 'Vietcombank',
      bankAccountNumber: '0011002233445',
      bankAccountHolder: 'CONG TY CO PHAN BENH VIEN AN SINH',
    };

    const validBusinessPdfFile = {
      buffer: Buffer.from('%PDF-1.7\nbusiness-scan-data'),
      size: 28,
      originalname: 'dkkd.pdf',
      mimetype: 'application/pdf',
    } as Express.Multer.File;

    const bothFiles = {
      operatingLicenseFile: [validPdfFile],
      businessLicenseFile: [validBusinessPdfFile],
    };

    it('DTO rejects missing address, licenseIssuer, or licenseDate and accepts complete payload', async () => {
      const pipe = new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      });

      await expect(
        pipe.transform(
          {
            licenseNumber: '01293/BYT-GPHĐ',
            taxCode: '0102030405',
            hotline: '19001234',
            bankName: 'Vietcombank',
            bankAccountNumber: '0011002233445',
            bankAccountHolder: 'CONG TY AN SINH',
          },
          { type: 'body', metatype: SubmitFacilityLegalProfileDto },
        ),
      ).rejects.toMatchObject({ status: 400 });

      await expect(
        pipe.transform(legalDto, {
          type: 'body',
          metatype: SubmitFacilityLegalProfileDto,
        }),
      ).resolves.toMatchObject(legalDto);
    });

    it('uploads both GPHĐ and ĐKKD scan files to S3, clears legalRejectionReason, and keeps verificationStatus PENDING', async () => {
      storageService.uploadFile
        .mockResolvedValueOnce('facility-legal/fac-uuid-1/operating-license.pdf')
        .mockResolvedValueOnce('facility-legal/fac-uuid-1/business-license.pdf');

      const result = await service.submitFacilityLegalProfile(
        facilityUser,
        legalDto,
        '127.0.0.1',
        bothFiles,
      );

      expect(result).toBeDefined();
      expect(storageService.uploadFile).toHaveBeenCalledWith(
        expect.objectContaining({
          mimetype: 'application/pdf',
          originalname: 'operating-license.pdf',
        }),
        'facility-legal/fac-uuid-1',
      );
      expect(storageService.uploadFile).toHaveBeenCalledWith(
        expect.objectContaining({
          mimetype: 'application/pdf',
          originalname: 'business-license.pdf',
        }),
        'facility-legal/fac-uuid-1',
      );
      expect(prismaService.healthcareFacility.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            licenseNumber: '01293/BYT-GPHĐ',
            licenseIssuer: 'Bộ Y tế - Cục Quản lý Khám chữa bệnh',
            address: '123 Giải Phóng, Phường Đồng Tâm, Quận Hai Bà Trưng, Hà Nội',
            bankName: 'Vietcombank',
            bankBin: null,
            bankCode: null,
            legalDocumentKey: 'facility-legal/fac-uuid-1/operating-license.pdf',
            businessLicenseKey: 'facility-legal/fac-uuid-1/business-license.pdf',
            legalDocumentsUrl: null,
            legalRejectionReason: null,
            verificationStatus: 'PENDING',
          }),
        }),
      );
    });

    it('persists bankBin and bankCode when provided and rejects invalid bankBin or >19 char account number', async () => {
      const pipe = new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      });

      const validWithBank = {
        ...legalDto,
        bankName: 'Vietcombank - Ngân hàng TMCP Ngoại thương Việt Nam',
        bankBin: '970436',
        bankCode: 'vcb',
      };
      const transformed = await pipe.transform(validWithBank, {
        type: 'body',
        metatype: SubmitFacilityLegalProfileDto,
      });
      expect(transformed.bankBin).toBe('970436');
      expect(transformed.bankCode).toBe('VCB');

      await expect(
        pipe.transform(
          { ...validWithBank, bankBin: 'invalid-bin' },
          { type: 'body', metatype: SubmitFacilityLegalProfileDto },
        ),
      ).rejects.toMatchObject({ status: 400 });

      await expect(
        pipe.transform(
          { ...validWithBank, bankAccountNumber: '12345678901234567890' },
          { type: 'body', metatype: SubmitFacilityLegalProfileDto },
        ),
      ).rejects.toMatchObject({ status: 400 });

      storageService.uploadFile
        .mockResolvedValueOnce('facility-legal/fac-uuid-1/operating-license.pdf')
        .mockResolvedValueOnce('facility-legal/fac-uuid-1/business-license.pdf');

      prismaService.healthcareFacility.update.mockResolvedValueOnce({
        ...mockFacility,
        bankName: transformed.bankName,
        bankBin: '970436',
        bankCode: 'VCB',
        bankAccountNumber: transformed.bankAccountNumber,
      });

      const res = await service.submitFacilityLegalProfile(
        facilityUser,
        transformed,
        '127.0.0.1',
        bothFiles,
      );

      expect(res.bankBin).toBe('970436');
      expect(res.bankCode).toBe('VCB');
      expect(prismaService.healthcareFacility.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            bankBin: '970436',
            bankCode: 'VCB',
          }),
        }),
      );
    });

    it('retains existing businessLicenseKey when facility resubmits only operatingLicenseFile', async () => {
      prismaService.healthcareFacility.findUnique.mockResolvedValue({
        ...mockFacility,
        legalDocumentKey: 'facility-legal/fac-uuid-1/old-gphd.pdf',
        businessLicenseKey: 'facility-legal/fac-uuid-1/existing-dkkd.pdf',
      });
      storageService.uploadFile.mockResolvedValueOnce(
        'facility-legal/fac-uuid-1/new-gphd.pdf',
      );

      await service.submitFacilityLegalProfile(
        facilityUser,
        legalDto,
        '127.0.0.1',
        { operatingLicenseFile: [validPdfFile] },
      );

      expect(storageService.uploadFile).toHaveBeenCalledTimes(1);
      expect(prismaService.healthcareFacility.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            legalDocumentKey: 'facility-legal/fac-uuid-1/new-gphd.pdf',
            businessLicenseKey: 'facility-legal/fac-uuid-1/existing-dkkd.pdf',
          }),
        }),
      );
    });

    it('requires both GPHĐ and ĐKKD scan files on initial submission', async () => {
      await expect(
        service.submitFacilityLegalProfile(facilityUser, legalDto, '127.0.0.1'),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.submitFacilityLegalProfile(facilityUser, legalDto, '127.0.0.1', {
          operatingLicenseFile: [validPdfFile],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects licenseDate in the future', async () => {
      await expect(
        service.submitFacilityLegalProfile(
          facilityUser,
          { ...legalDto, licenseDate: '2099-01-01' },
          '127.0.0.1',
          bothFiles,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts today licenseDate in Vietnam timezone during 00:00–06:59 UTC+7 and rejects ADMIN role', async () => {
      await expect(
        service.submitFacilityLegalProfile(
          adminUser,
          legalDto,
          '127.0.0.1',
          bothFiles,
        ),
      ).rejects.toThrow(ForbiddenException);

      jest.useFakeTimers();
      try {
        // 2026-11-17T18:30:00.000Z === 2026-11-18 01:30:00 UTC+7
        jest.setSystemTime(new Date('2026-11-17T18:30:00.000Z'));

        const res = await service.submitFacilityLegalProfile(
          facilityUser,
          { ...legalDto, licenseDate: '2026-11-18' },
          '127.0.0.1',
          bothFiles,
        );
        expect(res).toBeDefined();

        await expect(
          service.submitFacilityLegalProfile(
            facilityUser,
            { ...legalDto, licenseDate: '2026-11-19' },
            '127.0.0.1',
            bothFiles,
          ),
        ).rejects.toThrow(BadRequestException);
      } finally {
        jest.useRealTimers();
      }
    });

    it('rejects invalid magic bytes even if filename ends with .pdf', async () => {
      const fakeFile = {
        buffer: Buffer.from('not-a-pdf'),
        size: 9,
        originalname: 'fake.pdf',
        mimetype: 'application/pdf',
      } as Express.Multer.File;

      await expect(
        service.submitFacilityLegalProfile(
          facilityUser,
          legalDto,
          '127.0.0.1',
          {
            operatingLicenseFile: [fakeFile],
            businessLicenseFile: [validBusinessPdfFile],
          },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException if licenseNumber already exists on another facility', async () => {
      prismaService.healthcareFacility.findFirst.mockResolvedValueOnce({
        id: 'other-fac',
      });

      await expect(
        service.submitFacilityLegalProfile(
          facilityUser,
          legalDto,
          '127.0.0.1',
          bothFiles,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('throws BadRequestException if facility is already ACTIVE', async () => {
      prismaService.healthcareFacility.findUnique.mockResolvedValue({
        ...mockFacility,
        verificationStatus: FacilityVerificationStatus.ACTIVE,
      });

      await expect(
        service.submitFacilityLegalProfile(
          facilityUser,
          legalDto,
          '127.0.0.1',
          bothFiles,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('Step 3: verifyFacilityLegal', () => {
    const readyFacility = {
      ...mockFacility,
      user: { ...mockFacility.user, status: UserStatus.ACTIVE },
      licenseNumber: '01293/BYT-GPHĐ',
      taxCode: '0102030405',
      bankName: 'Vietcombank',
      bankAccountNumber: '0011002233445',
      bankAccountHolder: 'CONG TY AN SINH',
      legalDocumentKey: 'facility-legal/fac-uuid-1/operating-license.pdf',
      businessLicenseKey: 'facility-legal/fac-uuid-1/business-license.pdf',
      verificationStatus: FacilityVerificationStatus.PENDING,
    };

    it('activates facility (ACTIVE) on approval and notifies via notification + email', async () => {
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
            legalRejectionReason: null,
          }),
        }),
      );
      expect(mailerService.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: expect.stringContaining('kích hoạt thành công'),
        }),
      );
    });

    it('blocks approval when businessLicenseKey or legalDocumentKey is missing, while allowing rejection', async () => {
      prismaService.healthcareFacility.findUnique.mockResolvedValue({
        ...readyFacility,
        businessLicenseKey: null,
      });

      await expect(
        service.verifyFacilityLegal(
          adminUser,
          'fac-uuid-1',
          { approved: true },
          '127.0.0.1',
        ),
      ).rejects.toThrow(BadRequestException);

      await service.verifyFacilityLegal(
        adminUser,
        'fac-uuid-1',
        { approved: false, rejectionReason: 'Thiếu bản scan ĐKKD' },
        '127.0.0.1',
      );
      expect(prismaService.healthcareFacility.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            legalRejectionReason: 'Thiếu bản scan ĐKKD',
          }),
        }),
      );
    });

    it('stores legalRejectionReason and notifies facility when rejected', async () => {
      prismaService.healthcareFacility.findUnique.mockResolvedValue(readyFacility);

      await service.verifyFacilityLegal(
        adminUser,
        'fac-uuid-1',
        { approved: false, rejectionReason: 'Bản scan GPHĐ bị mờ' },
        '127.0.0.1',
      );

      expect(prismaService.healthcareFacility.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            legalRejectionReason: 'Bản scan GPHĐ bị mờ',
          }),
        }),
      );
      expect(prismaService.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'fac-user-uuid-1',
            type: 'FACILITY_LEGAL_REJECTED',
          }),
        }),
      );
    });

    it('requires rejectionReason when approved is false', async () => {
      prismaService.healthcareFacility.findUnique.mockResolvedValue(readyFacility);

      await expect(
        service.verifyFacilityLegal(
          adminUser,
          'fac-uuid-1',
          { approved: false, rejectionReason: '   ' },
          '127.0.0.1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ForbiddenException if non-admin calls', async () => {
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

  describe('Step 4: getFacilityLegalDocument', () => {
    it('allows Admin and owning Facility to download both operating and business documents, and blocks other Facilities', async () => {
      prismaService.healthcareFacility.findUnique.mockResolvedValue({
        id: 'fac-uuid-1',
        userId: 'fac-user-uuid-1',
        legalDocumentKey: 'facility-legal/fac-uuid-1/operating-license.pdf',
        businessLicenseKey: 'facility-legal/fac-uuid-1/business-license.pdf',
      });
      storageService.downloadFile = jest.fn().mockResolvedValue({
        bytes: Buffer.from('%PDF-1.4 test'),
        contentType: 'application/pdf',
      });

      const adminDoc = await service.getFacilityLegalDocument('fac-uuid-1', adminUser, 'operating');
      expect(adminDoc.contentType).toBe('application/pdf');
      expect(storageService.downloadFile).toHaveBeenCalledWith(
        'facility-legal/fac-uuid-1/operating-license.pdf',
      );

      const ownBizDoc = await service.getFacilityLegalDocument('fac-uuid-1', facilityUser, 'business');
      expect(ownBizDoc.contentType).toBe('application/pdf');
      expect(storageService.downloadFile).toHaveBeenCalledWith(
        'facility-legal/fac-uuid-1/business-license.pdf',
      );

      await expect(
        service.getFacilityLegalDocument('fac-uuid-1', {
          ...facilityUser,
          id: 'other-facility-user',
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('Step 5: getMyFacility staffing flags', () => {
    it('returns hasActiveStaffingContract=false and hasHistoricalStaffingContract=false when no B2B contract exists', async () => {
      prismaService.b2bStaffingContract.findFirst.mockResolvedValue(null);

      const res = await service.getMyFacility(facilityUser);

      expect(res.hasActiveStaffingContract).toBe(false);
      expect(res.hasHistoricalStaffingContract).toBe(false);
    });

    it('returns hasActiveStaffingContract=true when an ACTIVE B2B contract exists', async () => {
      prismaService.b2bStaffingContract.findFirst
        .mockResolvedValueOnce({ id: 'b2b-active' })
        .mockResolvedValueOnce({ id: 'b2b-active' });

      const res = await service.getMyFacility(facilityUser);

      expect(res.hasActiveStaffingContract).toBe(true);
      expect(res.hasHistoricalStaffingContract).toBe(true);
    });

    it('returns hasActiveStaffingContract=false and hasHistoricalStaffingContract=true when only historical contract exists', async () => {
      prismaService.b2bStaffingContract.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'b2b-terminated' });

      const res = await service.getMyFacility(facilityUser);

      expect(res.hasActiveStaffingContract).toBe(false);
      expect(res.hasHistoricalStaffingContract).toBe(true);
    });
  });
});
