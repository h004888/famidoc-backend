import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ContractsServiceImpl } from '../services/impl/contracts.service.impl';
import {
  CONTRACTS_REPOSITORY_TOKEN,
  IContractsRepository,
  ContractsSession,
} from '../repositories/interfaces/contracts.repository.interface';
import type { AuthenticatedUser } from '../../../core/auth/authenticated-request';
import { calculateContractTermsHash } from '../pricing/contract-terms-hash';

describe('ContractsServiceImpl - Initial 4-Party Medical Contracts (UC-16)', () => {
  let service: ContractsServiceImpl;
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

  const doctorUser: AuthenticatedUser = {
    id: 'doctor-user-1',
    role: 'DOCTOR',
    familyUnitId: null,
  };

  const mockPackage = {
    id: 'pkg-1',
    lineageCode: 'PKG-STANDARD',
    version: 1,
    packageName: 'Gói Tiêu Chuẩn',
    description: 'Chăm sóc sức khỏe gia đình',
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
    user: { id: 'doctor-user-1' },
  };

  const mockFamily = {
    id: 'fam-uuid-1',
    familyCode: 'FAM-001',
    representativeUserId: 'user-rep-1',
    status: 'ACTIVE',
  };

  const mockContract: any = {
    id: 'contract-uuid-1',
    contractNumber: 'MC2026TEST01',
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
      findDoctorById: jest.fn().mockResolvedValue(mockDoctor),
      findFamilyById: jest.fn().mockResolvedValue(mockFamily),
      findPatientsByIdsAndFamilyId: jest
        .fn()
        .mockResolvedValue([{ id: 'patient-1' }, { id: 'patient-2' }]),
      createContractMembers: jest.fn().mockResolvedValue(undefined),
      countFamilyMembers: jest.fn().mockResolvedValue(4),
      hasOtherActiveContract: jest.fn().mockResolvedValue(false),
      findContractForUpdate: jest.fn().mockResolvedValue(mockContract),
      findContractSignatures: jest.fn().mockResolvedValue([]),
      createUpgrade: jest.fn().mockResolvedValue(mockContract),
      createMedicalContract: jest.fn().mockResolvedValue(mockContract),
      saveUpgradeSignature: jest.fn().mockImplementation((data) => ({
        id: 'sig-1',
        ...data,
        createdAt: new Date(),
      })),
      saveSignature: jest.fn().mockImplementation((data) => ({
        id: 'sig-1',
        ...data,
        createdAt: new Date(),
      })),
      updateContractStatus: jest.fn().mockResolvedValue(undefined),
      recordChange: jest.fn().mockResolvedValue(undefined),
    };

    repositoryMock = {
      transaction: jest.fn().mockImplementation(async (cb) => cb(sessionMock)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContractsServiceImpl,
        {
          provide: CONTRACTS_REPOSITORY_TOKEN,
          useValue: repositoryMock,
        },
      ],
    }).compile();

    service = module.get<ContractsServiceImpl>(ContractsServiceImpl);
  });

  describe('createInitialMedicalContract', () => {
    it('should create initial medical contract in PENDING_APPROVAL status', async () => {
      const dto = {
        packageId: 'pkg-1',
        facilityId: 'fac-1',
        doctorId: 'doc-1',
        patientIds: ['patient-1', 'patient-2'],
      };

      const result = await (service as any).createInitialMedicalContract(
        familyRepUser,
        dto,
      );

      expect(result).toBeDefined();
      expect(result.contractStatus).toBe('PENDING_APPROVAL');
      expect(result.facilityId).toBe('fac-1');
      expect(result.doctorId).toBe('doc-1');
      expect(sessionMock.createContractMembers).toHaveBeenCalledWith(
        'contract-uuid-1',
        ['patient-1', 'patient-2'],
      );
      expect(sessionMock.findPackage).toHaveBeenCalledWith('pkg-1');
    });

    it('should create a pending contract without a doctor using exactly the selected family members', async () => {
      sessionMock.createMedicalContract.mockResolvedValue({
        ...mockContract,
        doctorId: null,
        doctor: null,
        memberCount: 2,
      });

      const result = await service.createInitialMedicalContract(familyRepUser, {
        packageId: 'pkg-1',
        facilityId: 'fac-1',
        patientIds: ['patient-1', 'patient-2'],
      } as any);

      expect(result.doctorId).toBeNull();
      expect(sessionMock.findDoctorById).not.toHaveBeenCalled();
      expect(sessionMock.createMedicalContract).toHaveBeenCalledWith(
        expect.objectContaining({ doctorId: null, memberCount: 2 }),
      );
      expect(sessionMock.createContractMembers).toHaveBeenCalledWith(
        'contract-uuid-1',
        ['patient-1', 'patient-2'],
      );
    });

    it('should reject selected patients outside the target family', async () => {
      sessionMock.findPatientsByIdsAndFamilyId.mockResolvedValue([
        { id: 'patient-1' },
      ]);

      await expect(
        service.createInitialMedicalContract(familyRepUser, {
          packageId: 'pkg-1',
          facilityId: 'fac-1',
          patientIds: ['patient-1', 'patient-from-another-family'],
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject a memberCount that disagrees with patientIds', async () => {
      await expect(
        service.createInitialMedicalContract(familyRepUser, {
          packageId: 'pkg-1',
          facilityId: 'fac-1',
          patientIds: ['patient-1', 'patient-2'],
          memberCount: 3,
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if package is not active', async () => {
      sessionMock.findPackage.mockResolvedValue(null);

      const dto = {
        packageId: 'pkg-inactive',
        facilityId: 'fac-1',
        doctorId: 'doc-1',
        patientIds: ['patient-1'],
      };

      await expect(
        (service as any).createInitialMedicalContract(familyRepUser, dto),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('signInitialMedicalContract', () => {
    it('should require a doctor before a facility signs an unassigned contract', async () => {
      const unassignedContract = {
        ...mockContract,
        doctorId: null,
        doctor: null,
      };
      sessionMock.findContractForUpdate.mockResolvedValue(unassignedContract);
      const hash = calculateContractTermsHash(unassignedContract);

      await expect(
        service.signInitialMedicalContract(
          facilityUser,
          'contract-uuid-1',
          { acceptedTerms: true, termsHash: hash },
          '127.0.0.1',
        ),
      ).rejects.toThrow(
        'Cơ sở y tế phải phân công bác sĩ trước khi ký tiếp nhận',
      );
    });
    it('should allow FAMILY_REP to sign first', async () => {
      const hash = calculateContractTermsHash(mockContract);
      const signDto = {
        acceptedTerms: true,
        termsHash: hash,
      };

      const result = await (service as any).signInitialMedicalContract(
        familyRepUser,
        'contract-uuid-1',
        signDto,
        '127.0.0.1',
      );

      expect(result).toBeDefined();
      expect(result.signerRole).toBe('FAMILY_REP');
      expect(sessionMock.updateContractStatus).not.toHaveBeenCalled();
    });

    it('should throw ConflictException if ADMIN tries to sign before FAMILY_REP', async () => {
      const hash = calculateContractTermsHash(mockContract);
      const signDto = {
        acceptedTerms: true,
        termsHash: hash,
      };

      sessionMock.findContractSignatures.mockResolvedValue([]);

      await expect(
        (service as any).signInitialMedicalContract(
          adminUser,
          'contract-uuid-1',
          signDto,
          '127.0.0.1',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('should transition contract to PENDING_PAYMENT when 4th party signs', async () => {
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

      const result = await (service as any).signInitialMedicalContract(
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
  });
});
