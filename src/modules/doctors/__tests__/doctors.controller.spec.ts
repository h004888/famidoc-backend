import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  ExcelUploadSizeFilter,
  FacilitiesDoctorsController,
} from '../controllers/facilities-doctors.controller';
import { FacilitiesController } from '../controllers/facilities.controller';
import { DoctorsController } from '../controllers/doctors.controller';
import {
  DOCTORS_SERVICE_TOKEN,
  IDoctorsService,
} from '../services/interfaces/doctors.service.interface';
import { JwtAuthGuard } from '../../../core/auth/jwt-auth.guard';
import { RolesGuard } from '../../../core/auth/roles.guard';
import type { AuthenticatedRequest } from '../../../core/auth/authenticated-request';
import { DoctorCredentialType, DoctorOnboardingStatus } from '@prisma/client';

describe('Doctors & Facilities Controllers', () => {
  let facilitiesDoctorsController: FacilitiesDoctorsController;
  let facilitiesController: FacilitiesController;
  let doctorsController: DoctorsController;
  let service: jest.Mocked<IDoctorsService>;

  const mockAdminReq = {
    user: {
      id: 'admin-1',
      role: 'ADMIN' as const,
      email: 'admin@famidoc.vn',
    },
    ip: '127.0.0.1',
  } as unknown as AuthenticatedRequest;

  const mockFacilityReq = {
    user: {
      id: 'fac-user-1',
      role: 'HEALTHCARE_FACILITY' as const,
      email: 'contact@hospital.vn',
    },
    ip: '127.0.0.1',
  } as unknown as AuthenticatedRequest;

  const mockDoctorReq = {
    user: {
      id: 'doc-user-1',
      role: 'DOCTOR' as const,
      email: 'bs.an@famidoc.vn',
    },
    ip: '127.0.0.1',
  } as unknown as AuthenticatedRequest;

  const mockDoctorResponse = {
    id: 'doc-uuid-1',
    userId: 'doc-user-1',
    facilityId: 'fac-uuid-1',
    email: 'bs.an@famidoc.vn',
    phone: '0912345678',
    mailSent: true,
    doctorName: 'BS. CKI Nguyễn Văn An',
    specialty: 'Y học gia đình',
    academicTitle: 'BS.CKI',
    experienceYears: 8,
    bio: 'Tiểu sử',
    activePanelCount: 0,
    maxPanelCapacity: 30,
    ratingAvg: 5.0,
    totalReviews: 0,
    onboardingStatus: DoctorOnboardingStatus.PENDING_SUBMISSION,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    service = {
      provisionDoctorAccount: jest.fn().mockResolvedValue(mockDoctorResponse),
      generateDoctorImportTemplate: jest
        .fn()
        .mockResolvedValue(Buffer.from('PK\x03\x04template')),
      previewDoctorsExcelImport: jest.fn().mockResolvedValue({
        summary: {
          totalReadRows: 1,
          validCount: 1,
          existingSkippedCount: 0,
          invalidCount: 0,
          maxReadRows: 100,
          maxConfirmBatch: 30,
        },
        validRows: [],
        existingRows: [],
        invalidRows: [],
      }),
      confirmDoctorsBulkImport: jest.fn().mockResolvedValue({
        summary: {
          requestedCount: 1,
          createdCount: 1,
          failedCount: 0,
          mailSentCount: 1,
          mailFailedCount: 0,
        },
        createdDoctors: [],
        failedRows: [],
      }),
      submitDoctorCredentials: jest.fn().mockResolvedValue(mockDoctorResponse),
      getDoctorCredentialFile: jest.fn().mockResolvedValue({
        bytes: Buffer.from('%PDF-1.4'),
        contentType: 'application/pdf',
      }),
      approveDoctorCredentialsByFacility: jest.fn().mockResolvedValue({
        ...mockDoctorResponse,
        onboardingStatus: DoctorOnboardingStatus.FACILITY_VERIFIED,
      }),
      approveDoctorCredentialsByPlatform: jest.fn().mockResolvedValue({
        ...mockDoctorResponse,
        onboardingStatus: DoctorOnboardingStatus.ACTIVE,
      }),
      getDoctorProfile: jest.fn().mockResolvedValue(mockDoctorResponse),
      listDoctors: jest.fn().mockResolvedValue({
        items: [mockDoctorResponse],
        total: 1,
        page: 1,
        limit: 10,
      }),
      listFacilityDoctors: jest.fn().mockResolvedValue({
        items: [mockDoctorResponse],
        total: 1,
        page: 1,
        limit: 10,
      }),
      createFacilityByAdmin: jest.fn(),
      submitFacilityLegalProfile: jest.fn(),
      verifyFacilityLegal: jest.fn(),
      getFacilityLegalDocument: jest.fn().mockResolvedValue({
        bytes: Buffer.from('%PDF-1.4'),
        contentType: 'application/pdf',
      }),
      getMyFacility: jest.fn(),
      listFacilitiesForAdmin: jest.fn(),
      getFacilityDetailForAdmin: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [
        FacilitiesDoctorsController,
        FacilitiesController,
        DoctorsController,
      ],
      providers: [
        {
          provide: DOCTORS_SERVICE_TOKEN,
          useValue: service,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    facilitiesDoctorsController = module.get<FacilitiesDoctorsController>(
      FacilitiesDoctorsController,
    );
    facilitiesController =
      module.get<FacilitiesController>(FacilitiesController);
    doctorsController = module.get<DoctorsController>(DoctorsController);
  });

  describe('FacilitiesDoctorsController - provisionDoctorAccount (STT 15)', () => {
    it('should delegate to service.provisionDoctorAccount', async () => {
      const dto = {
        email: 'bs.an@famidoc.vn',
        phone: '0912345678',
        doctorName: 'BS. CKI Nguyễn Văn An',
        specialty: 'Y học gia đình',
        experienceYears: 8,
      };

      const result = await facilitiesDoctorsController.provisionDoctorAccount(
        mockFacilityReq,
        dto,
      );

      expect(result).toBe(mockDoctorResponse);
      expect(result.email).toBe('bs.an@famidoc.vn');
      expect(result.phone).toBe('0912345678');
      expect(result.mailSent).toBe(true);
      expect(service.provisionDoctorAccount).toHaveBeenCalledWith(
        mockFacilityReq.user,
        dto,
        '127.0.0.1',
      );
    });
  });

  describe('DoctorsController - submitDoctorCredentials (STT 16)', () => {
    it('should delegate to service.submitDoctorCredentials', async () => {
      const dto = {
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

      const result = await doctorsController.submitDoctorCredentials(
        mockDoctorReq,
        'doc-uuid-1',
        dto,
      );

      expect(result).toBe(mockDoctorResponse);
      expect(service.submitDoctorCredentials).toHaveBeenCalledWith(
        mockDoctorReq.user,
        'doc-uuid-1',
        dto,
        '127.0.0.1',
        undefined,
      );
    });

    it('should delegate submitMyCredentials with "me" alias', async () => {
      const dto = {
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

      const result = await (doctorsController as any).submitMyCredentials(
        mockDoctorReq,
        dto,
      );

      expect(result).toBe(mockDoctorResponse);
      expect(service.submitDoctorCredentials).toHaveBeenCalledWith(
        mockDoctorReq.user,
        'me',
        dto,
        '127.0.0.1',
        undefined,
      );
    });
  });

  describe('DoctorsController - approveDoctorCredentialsByFacility (STT 17)', () => {
    it('should delegate to service.approveDoctorCredentialsByFacility', async () => {
      const dto = { approved: true };

      const result = await doctorsController.approveDoctorCredentialsByFacility(
        mockAdminReq,
        'doc-uuid-1',
        dto,
      );

      expect(result.onboardingStatus).toBe(
        DoctorOnboardingStatus.FACILITY_VERIFIED,
      );
      expect(service.approveDoctorCredentialsByFacility).toHaveBeenCalledWith(
        mockAdminReq.user,
        'doc-uuid-1',
        dto,
        '127.0.0.1',
      );
    });
  });

  describe('DoctorsController - approveDoctorCredentialsByPlatform (STT 18)', () => {
    it('should delegate to service.approveDoctorCredentialsByPlatform', async () => {
      const dto = { approved: true };

      const result = await doctorsController.approveDoctorCredentialsByPlatform(
        mockAdminReq,
        'doc-uuid-1',
        dto,
      );

      expect(result.onboardingStatus).toBe(DoctorOnboardingStatus.ACTIVE);
      expect(service.approveDoctorCredentialsByPlatform).toHaveBeenCalledWith(
        mockAdminReq.user,
        'doc-uuid-1',
        dto,
        '127.0.0.1',
      );
    });
  });

  describe('DoctorsController - getDoctorProfile', () => {
    it('should delegate to service.getDoctorProfile', async () => {
      const result = await doctorsController.getDoctorProfile(
        mockAdminReq,
        'doc-uuid-1',
      );

      expect(result).toBe(mockDoctorResponse);
      expect(service.getDoctorProfile).toHaveBeenCalledWith(
        mockAdminReq.user,
        'doc-uuid-1',
      );
    });

    it('should delegate getMyDoctorProfile to service.getDoctorProfile with me', async () => {
      const result = await doctorsController.getMyDoctorProfile(mockDoctorReq);

      expect(result).toBe(mockDoctorResponse);
      expect(service.getDoctorProfile).toHaveBeenCalledWith(
        mockDoctorReq.user,
        'me',
      );
    });

    it('should delegate listDoctors to service.listDoctors', async () => {
      const query = { page: 1, limit: 10 };
      const result = await doctorsController.listDoctors(mockAdminReq, query);

      expect(result.items).toHaveLength(1);
      expect(service.listDoctors).toHaveBeenCalledWith(mockAdminReq.user, query);
    });

    it('should delegate listFacilityDoctors to service.listFacilityDoctors', async () => {
      const query = { page: 1, limit: 10 };
      const result = await facilitiesDoctorsController.listFacilityDoctors(
        mockFacilityReq,
        query,
      );

      expect(result.items).toHaveLength(1);
      expect(service.listFacilityDoctors).toHaveBeenCalledWith(
        mockFacilityReq.user,
        query,
      );
    });
  });

  describe('DoctorsController - reviewDoctorCredentials', () => {
    it('should delegate tier 1 review to service.approveDoctorCredentialsByFacility', async () => {
      const reviewDto = {
        tier: 1,
        approved: true,
        verificationNotes: 'Đầy đủ CCHN',
      };

      const result = await (doctorsController as any).reviewDoctorCredentials(
        mockAdminReq,
        'doc-uuid-1',
        reviewDto,
      );

      expect(result.onboardingStatus).toBe(
        DoctorOnboardingStatus.FACILITY_VERIFIED,
      );
      expect(service.approveDoctorCredentialsByFacility).toHaveBeenCalledWith(
        mockAdminReq.user,
        'doc-uuid-1',
        expect.objectContaining({ approved: true }),
        '127.0.0.1',
      );
    });

    it('should delegate tier 2 review to service.approveDoctorCredentialsByPlatform', async () => {
      const reviewDto = {
        tier: 2,
        approved: true,
      };

      const result = await (doctorsController as any).reviewDoctorCredentials(
        mockAdminReq,
        'doc-uuid-1',
        reviewDto,
      );

      expect(result.onboardingStatus).toBe(DoctorOnboardingStatus.ACTIVE);
      expect(service.approveDoctorCredentialsByPlatform).toHaveBeenCalledWith(
        mockAdminReq.user,
        'doc-uuid-1',
        expect.objectContaining({ approved: true }),
        '127.0.0.1',
      );
    });
  });

  describe('FacilitiesController - legal document ?type= query validation', () => {
    it('delegates ?type=business and default operating type to service.getFacilityLegalDocument', async () => {
      await facilitiesController.getMyLegalDocument(mockFacilityReq, 'business');
      expect(service.getFacilityLegalDocument).toHaveBeenCalledWith(
        'me',
        mockFacilityReq.user,
        'business',
      );

      await facilitiesController.getLegalDocument(
        mockAdminReq,
        'fac-uuid-1',
        undefined,
      );
      expect(service.getFacilityLegalDocument).toHaveBeenCalledWith(
        'fac-uuid-1',
        mockAdminReq.user,
        'operating',
      );
    });

    it('rejects invalid ?type= query parameter with BadRequestException', async () => {
      await expect(
        facilitiesController.getMyLegalDocument(mockFacilityReq, 'invalid'),
      ).rejects.toThrow(BadRequestException);

      await expect(
        facilitiesController.getLegalDocument(
          mockAdminReq,
          'fac-uuid-1',
          'unknown',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('FacilitiesDoctorsController - Excel bulk import endpoints', () => {
    it('delegates template download as StreamableFile', async () => {
      const stream =
        await facilitiesDoctorsController.downloadDoctorImportTemplate(
          mockFacilityReq,
        );
      expect(service.generateDoctorImportTemplate).toHaveBeenCalledWith(
        mockFacilityReq.user,
      );
      expect(stream).toBeDefined();
    });

    it('delegates preview upload to service.previewDoctorsExcelImport', async () => {
      const mockFile = {
        originalname: 'doctors.xlsx',
        buffer: Buffer.from('PK\x03\x04'),
      } as Express.Multer.File;
      await facilitiesDoctorsController.previewDoctorsImport(
        mockFacilityReq,
        mockFile,
      );
      expect(service.previewDoctorsExcelImport).toHaveBeenCalledWith(
        mockFacilityReq.user,
        mockFile,
      );
    });

    it('delegates confirm payload to service.confirmDoctorsBulkImport', async () => {
      const payload = {
        doctors: [
          {
            rowNumber: 2,
            doctorName: 'BS. Nguyễn Văn An',
            email: 'bs.an@hospital.vn',
            phone: '0912345678',
          },
        ],
      };
      await facilitiesDoctorsController.confirmDoctorsImport(
        mockFacilityReq,
        payload,
      );
      expect(service.confirmDoctorsBulkImport).toHaveBeenCalledWith(
        mockFacilityReq.user,
        payload,
        '127.0.0.1',
      );
    });

    it('maps Multer PayloadTooLargeException to 400 Vietnamese message via ExcelUploadSizeFilter', () => {
      const filter = new ExcelUploadSizeFilter();
      const jsonMock = jest.fn();
      const statusMock = jest.fn().mockReturnValue({ json: jsonMock });
      const mockHost = {
        switchToHttp: () => ({
          getResponse: () => ({ status: statusMock }),
          getRequest: () => ({
            url: '/api/v1/facilities/doctors/import/preview',
            headers: {},
          }),
        }),
      } as any;

      filter.catch(new PayloadTooLargeException('File too large'), mockHost);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          code: 400,
          message: 'Dung lượng file Excel vượt quá giới hạn tối đa 2MB',
        }),
      );
    });
  });
});
