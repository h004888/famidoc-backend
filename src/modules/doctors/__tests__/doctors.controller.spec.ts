import { Test, TestingModule } from '@nestjs/testing';
import { FacilitiesDoctorsController } from '../controllers/facilities-doctors.controller';
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
      submitDoctorCredentials: jest.fn().mockResolvedValue(mockDoctorResponse),
      approveDoctorCredentialsByFacility: jest.fn().mockResolvedValue({
        ...mockDoctorResponse,
        onboardingStatus: DoctorOnboardingStatus.FACILITY_VERIFIED,
      }),
      approveDoctorCredentialsByPlatform: jest.fn().mockResolvedValue({
        ...mockDoctorResponse,
        onboardingStatus: DoctorOnboardingStatus.ACTIVE,
      }),
      getDoctorProfile: jest.fn().mockResolvedValue(mockDoctorResponse),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [FacilitiesDoctorsController, DoctorsController],
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
});
