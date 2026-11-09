import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ContractsServiceImpl } from '../services/impl/contracts.service.impl';
import { ContractsController } from '../controllers/contracts.controller';
import {
  CONTRACTS_REPOSITORY_TOKEN,
  type IContractsRepository,
} from '../repositories/interfaces/contracts.repository.interface';
import { CONTRACTS_SERVICE_TOKEN } from '../services/interfaces/contracts.service.interface';
import type { AuthenticatedUser } from '../../../core/auth/authenticated-request';
import { calculateContractTermsHash } from '../pricing/contract-terms-hash';
import { JwtAuthGuard } from '../../../core/auth/jwt-auth.guard';
import { RolesGuard } from '../../../core/auth/roles.guard';

describe('Four-Party Contract & Doctor Assignment (UC-16, UC-23, SD-16, SD-23)', () => {
  let service: ContractsServiceImpl;
  let controller: ContractsController;
  let sessionMock: any;
  let repositoryMock: Partial<IContractsRepository>;

  const familyRepUser: AuthenticatedUser = {
    id: 'user-rep-1',
    role: 'FAMILY_REP',
    familyUnitId: 'fam-uuid-1',
  };

  const adminUser: AuthenticatedUser = {
    id: 'admin-uuid-1',
    role: 'ADMIN',
    familyUnitId: null,
  };

  const facilityUser: AuthenticatedUser = {
    id: 'facility-user-1',
    role: 'HEALTHCARE_FACILITY',
    familyUnitId: null,
  };

  const otherFacilityUser: AuthenticatedUser = {
    id: 'facility-user-2',
    role: 'HEALTHCARE_FACILITY',
    familyUnitId: null,
  };

  const doctorUser: AuthenticatedUser = {
    id: 'doctor-user-1',
    role: 'DOCTOR',
    familyUnitId: null,
  };

  const mockPackage = {
    id: 'pkg-1',
    lineageCode: 'PKG-STANDARD',
    version: 1,
    packageName: 'Gói Chăm Sóc Toàn Diện',
    description: 'Chăm sóc sức khỏe gia đình chuẩn Bộ Y tế',
    durationMonths: 12,
    basePrice: '12000000',
    includedMembers: 4,
    maxMembers: 6,
    additionalMemberMonthlyPrice: '100000',
    quotaPeriod: 'CONTRACT_YEAR',
    periodicVisitsQuota: 4,
    telehealthQuota: 12,
    status: 'ACTIVE',
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    publishedAt: new Date(),
  };

  const mockFacility = {
    id: 'fac-1',
    userId: 'facility-user-1',
    facilityName: 'Bệnh viện Đa khoa Quốc tế',
    verificationStatus: 'ACTIVE',
  };

  const mockDoctor = {
    id: 'doc-1',
    userId: 'doctor-user-1',
    facilityId: 'fac-1',
    doctorName: 'BS. Nguyễn Văn An',
    onboardingStatus: 'ACTIVE',
    activePanelCount: 5,
    maxPanelCapacity: 30,
    user: { id: 'doctor-user-1' },
  };

  const mockDoctor2 = {
    id: 'doc-2',
    userId: 'doctor-user-2',
    facilityId: 'fac-1',
    doctorName: 'BS. Trần Thị Bình',
    onboardingStatus: 'ACTIVE',
    activePanelCount: 10,
    maxPanelCapacity: 30,
    user: { id: 'doctor-user-2' },
  };

  const mockFullDoctor = {
    id: 'doc-full',
    userId: 'doctor-user-full',
    facilityId: 'fac-1',
    doctorName: 'BS. Bận Rộn',
    onboardingStatus: 'ACTIVE',
    activePanelCount: 30,
    maxPanelCapacity: 30,
    user: { id: 'doctor-user-full' },
  };

  const mockFamily = {
    id: 'fam-uuid-1',
    familyCode: 'FAM-001',
    representativeUserId: 'user-rep-1',
    status: 'ACTIVE',
  };

  const mockContract: any = {
    id: 'contract-uuid-1',
    contractNumber: 'CTR-2026-000001',
    familyId: 'fam-uuid-1',
    facilityId: 'fac-1',
    doctorId: 'doc-1',
    packageId: 'pkg-1',
    totalAmount: '12000000',
    remainingHomeVisits: 4,
    remainingTelehealth: 12,
    startDate: new Date('2026-01-01'),
    endDate: new Date('2027-01-01'),
    contractStatus: 'PENDING_APPROVAL',
    memberCount: 4,
    isDemo: false,
    upgradedFromId: null,
    billingSnapshot: {},
    familyUnit: mockFamily,
    facility: mockFacility,
    doctor: mockDoctor,
    servicePackage: mockPackage,
  };

  beforeEach(async () => {
    sessionMock = {
      findPackage: jest.fn().mockResolvedValue(mockPackage),
      findFacilityById: jest.fn().mockResolvedValue(mockFacility),
      findDoctorById: jest.fn().mockImplementation((id: string) => {
        if (id === 'doc-1') return Promise.resolve(mockDoctor);
        if (id === 'doc-2') return Promise.resolve(mockDoctor2);
        if (id === 'doc-full') return Promise.resolve(mockFullDoctor);
        if (id === 'doc-other-fac')
          return Promise.resolve({
            ...mockDoctor,
            id: 'doc-other-fac',
            facilityId: 'fac-other',
          });
        return Promise.resolve(null);
      }),
      findFamilyById: jest.fn().mockResolvedValue(mockFamily),
      findPatientsByIdsAndFamilyId: jest
        .fn()
        .mockResolvedValue([
          { id: 'patient-1' },
          { id: 'patient-2' },
          { id: 'patient-3' },
          { id: 'patient-4' },
        ]),
      createContractMembers: jest.fn().mockResolvedValue(undefined),
      countFamilyMembers: jest.fn().mockResolvedValue(4),
      findContractForUpdate: jest.fn().mockResolvedValue(mockContract),
      findContractSignatures: jest.fn().mockResolvedValue([]),
      createMedicalContract: jest.fn().mockResolvedValue(mockContract),
      saveSignature: jest.fn().mockImplementation((data) => ({
        id: 'sig-uuid-1',
        ...data,
        createdAt: new Date(),
      })),
      updateContractStatus: jest.fn().mockResolvedValue(undefined),
      updateContractDoctor: jest.fn().mockImplementation((id, doctorId) => ({
        ...mockContract,
        doctorId,
      })),
      refreshDoctorPanel: jest.fn().mockResolvedValue(undefined),
      recordChange: jest.fn().mockResolvedValue(undefined),
    };

    repositoryMock = {
      transaction: jest.fn().mockImplementation(async (cb) => cb(sessionMock)),
    };

    const serviceModule: TestingModule = await Test.createTestingModule({
      providers: [
        ContractsServiceImpl,
        {
          provide: CONTRACTS_REPOSITORY_TOKEN,
          useValue: repositoryMock,
        },
      ],
    }).compile();

    service = serviceModule.get<ContractsServiceImpl>(ContractsServiceImpl);

    const controllerModule: TestingModule = await Test.createTestingModule({
      controllers: [ContractsController],
      providers: [
        {
          provide: CONTRACTS_SERVICE_TOKEN,
          useValue: service,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = controllerModule.get<ContractsController>(ContractsController);
  });

  describe('1. initiateFourPartyContract (STT 28 - UC-16, SD-16)', () => {
    const dto = {
      packageId: 'pkg-1',
      facilityId: 'fac-1',
      doctorId: 'doc-1',
      memberCount: 4,
      patientIds: ['patient-1', 'patient-2', 'patient-3', 'patient-4'],
    };

    it('should successfully initiate four-party contract by Family Representative', async () => {
      const result = await service.initiateFourPartyContract(
        familyRepUser,
        dto,
      );

      expect(result).toBeDefined();
      expect(result.contractStatus).toBe('PENDING_APPROVAL');
      expect(result.facilityId).toBe('fac-1');
      expect(result.doctorId).toBe('doc-1');
      expect(sessionMock.findPackage).toHaveBeenCalledWith('pkg-1');
      expect(sessionMock.findFacilityById).toHaveBeenCalledWith('fac-1');
      expect(sessionMock.findDoctorById).toHaveBeenCalledWith('doc-1');
    });

    it('should successfully initiate four-party contract by Admin with explicit familyId', async () => {
      const adminDto = { ...dto, familyId: 'fam-uuid-1' };
      const result = await service.initiateFourPartyContract(
        adminUser,
        adminDto,
      );

      expect(result).toBeDefined();
      expect(sessionMock.findFamilyById).toHaveBeenCalledWith('fam-uuid-1');
    });

    it('should throw BadRequestException if package is not found or inactive', async () => {
      sessionMock.findPackage.mockResolvedValue(null);

      await expect(
        service.initiateFourPartyContract(familyRepUser, dto),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw ConflictException if doctor has reached maximum panel limit (30/30) (BR-04, CFG-01)', async () => {
      const fullDto = { ...dto, doctorId: 'doc-full' };

      await expect(
        service.initiateFourPartyContract(familyRepUser, fullDto),
      ).rejects.toThrow(ConflictException);
    });

    it('should call controller.initiateFourPartyContract and forward to service', async () => {
      const mockReq: any = { user: familyRepUser };
      const result = await controller.initiateFourPartyContract(mockReq, dto);

      expect(result).toBeDefined();
      expect(result.contractStatus).toBe('PENDING_APPROVAL');
    });
  });

  describe('2. signFourPartyContract (STT 29 - UC-16, SD-16)', () => {
    it('should allow FAMILY_REP to sign first', async () => {
      const hash = calculateContractTermsHash(mockContract);
      const signDto = {
        acceptedTerms: true,
        termsHash: hash,
      };

      const result = await service.signFourPartyContract(
        familyRepUser,
        'contract-uuid-1',
        signDto,
        '127.0.0.1',
      );

      expect(result).toBeDefined();
      expect(result.signerRole).toBe('FAMILY_REP');
      expect(sessionMock.updateContractStatus).not.toHaveBeenCalled();
    });

    it('should throw ConflictException if ADMIN signs before FAMILY_REP', async () => {
      const hash = calculateContractTermsHash(mockContract);
      const signDto = {
        acceptedTerms: true,
        termsHash: hash,
      };
      sessionMock.findContractSignatures.mockResolvedValue([]);

      await expect(
        service.signFourPartyContract(
          adminUser,
          'contract-uuid-1',
          signDto,
          '127.0.0.1',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('should transition contract to PENDING_PAYMENT when 4th party (ASSIGNED_DOCTOR) signs', async () => {
      const hash = calculateContractTermsHash(mockContract);
      const signDto = {
        acceptedTerms: true,
        termsHash: hash,
      };

      sessionMock.findContractSignatures.mockResolvedValue([
        { signerRole: 'FAMILY_REP', signerUserId: 'user-rep-1' },
        { signerRole: 'ADMIN', signerUserId: 'admin-uuid-1' },
        { signerRole: 'HEALTHCARE_FACILITY', signerUserId: 'facility-user-1' },
      ]);

      const result = await service.signFourPartyContract(
        doctorUser,
        'contract-uuid-1',
        signDto,
        '127.0.0.1',
      );

      expect(result).toBeDefined();
      expect(result.signerRole).toBe('ASSIGNED_DOCTOR');
      expect(sessionMock.updateContractStatus).toHaveBeenCalledWith(
        'contract-uuid-1',
        'PENDING_PAYMENT',
      );
    });

    it('should call controller.signFourPartyContract and forward to service', async () => {
      const hash = calculateContractTermsHash(mockContract);
      const signDto = {
        acceptedTerms: true,
        termsHash: hash,
      };
      const mockReq: any = { user: familyRepUser, ip: '127.0.0.1' };

      const result = await controller.signFourPartyContract(
        mockReq,
        'contract-uuid-1',
        signDto,
      );

      expect(result).toBeDefined();
      expect(result.signerRole).toBe('FAMILY_REP');
    });
  });

  describe('3. assignDoctorToPackage (STT 30 - UC-23, SD-23)', () => {
    const assignDto = {
      doctorId: 'doc-2',
    };

    it('should successfully assign / reassign doctor to contract by managing facility', async () => {
      const result = await service.assignDoctorToPackage(
        facilityUser,
        'contract-uuid-1',
        assignDto,
        '127.0.0.1',
      );

      expect(result).toBeDefined();
      expect(sessionMock.findContractForUpdate).toHaveBeenCalledWith(
        'contract-uuid-1',
      );
      expect(sessionMock.updateContractDoctor).toHaveBeenCalledWith(
        'contract-uuid-1',
        'doc-2',
      );
      expect(sessionMock.recordChange).toHaveBeenCalledWith(
        facilityUser.id,
        expect.anything(),
        'ASSIGN_DOCTOR_TO_CONTRACT',
        'contract-uuid-1',
      );
    });

    it('should refresh panel counters for both old and new doctors if contract is ACTIVE (BR-03)', async () => {
      sessionMock.findContractForUpdate.mockResolvedValue({
        ...mockContract,
        contractStatus: 'ACTIVE',
        doctorId: 'doc-1',
      });

      await service.assignDoctorToPackage(
        facilityUser,
        'contract-uuid-1',
        assignDto,
        '127.0.0.1',
      );

      expect(sessionMock.refreshDoctorPanel).toHaveBeenCalledWith('doc-1');
      expect(sessionMock.refreshDoctorPanel).toHaveBeenCalledWith('doc-2');
    });

    it('should throw ForbiddenException if another facility tries to reassign doctor', async () => {
      await expect(
        service.assignDoctorToPackage(
          otherFacilityUser,
          'contract-uuid-1',
          assignDto,
          '127.0.0.1',
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException if contract is not found', async () => {
      sessionMock.findContractForUpdate.mockResolvedValue(null);

      await expect(
        service.assignDoctorToPackage(
          facilityUser,
          'non-existent',
          assignDto,
          '127.0.0.1',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ConflictException if contract is TERMINATED', async () => {
      sessionMock.findContractForUpdate.mockResolvedValue({
        ...mockContract,
        contractStatus: 'TERMINATED',
      });

      await expect(
        service.assignDoctorToPackage(
          facilityUser,
          'contract-uuid-1',
          assignDto,
          '127.0.0.1',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw BadRequestException if new doctor belongs to another facility', async () => {
      const otherFacDto = { doctorId: 'doc-other-fac' };

      await expect(
        service.assignDoctorToPackage(
          facilityUser,
          'contract-uuid-1',
          otherFacDto,
          '127.0.0.1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw ConflictException if new doctor has reached 30 active households (BR-04, CFG-01)', async () => {
      const fullDocDto = { doctorId: 'doc-full' };

      await expect(
        service.assignDoctorToPackage(
          facilityUser,
          'contract-uuid-1',
          fullDocDto,
          '127.0.0.1',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('should call controller.assignDoctorToPackage and return updated contract', async () => {
      const mockReq: any = { user: facilityUser, ip: '127.0.0.1' };
      const result = await controller.assignDoctorToPackage(
        mockReq,
        'contract-uuid-1',
        assignDto,
      );

      expect(result).toBeDefined();
      expect(sessionMock.updateContractDoctor).toHaveBeenCalledWith(
        'contract-uuid-1',
        'doc-2',
      );
    });
  });
});
