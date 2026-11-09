import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ContractsServiceImpl } from '../services/impl/contracts.service.impl';
import { ContractsController } from '../controllers/contracts.controller';
import {
  CONTRACTS_REPOSITORY_TOKEN,
  type IContractsRepository,
} from '../repositories/interfaces/contracts.repository.interface';
import { CONTRACTS_SERVICE_TOKEN } from '../services/interfaces/contracts.service.interface';
import type { AuthenticatedUser } from '../../../core/auth/authenticated-request';
import { JwtAuthGuard } from '../../../core/auth/jwt-auth.guard';
import { RolesGuard } from '../../../core/auth/roles.guard';
import type { ListMedicalContractsQueryDto } from '../dtos/list-medical-contracts-query.dto';

describe('Medical Contracts Query - List & Detail by Role (Task 5)', () => {
  let service: ContractsServiceImpl;
  let controller: ContractsController;
  let sessionMock: any;
  let repositoryMock: Partial<IContractsRepository>;

  const familyRepUser: AuthenticatedUser = {
    id: 'user-rep-1',
    role: 'FAMILY_REP',
    familyUnitId: 'fam-uuid-1',
  };

  const otherFamilyRepUser: AuthenticatedUser = {
    id: 'user-rep-2',
    role: 'FAMILY_REP',
    familyUnitId: 'fam-uuid-2',
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

  const otherDoctorUser: AuthenticatedUser = {
    id: 'doctor-user-2',
    role: 'DOCTOR',
    familyUnitId: null,
  };

  const mockFamily = {
    id: 'fam-uuid-1',
    familyCode: 'FAM-001',
    representativeUserId: 'user-rep-1',
    status: 'ACTIVE',
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

  const mockPackage = {
    id: 'pkg-1',
    packageName: 'Gói Chăm Sóc Toàn Diện',
    durationMonths: 12,
  };

  const mockContractDetail: any = {
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
    memberCount: 2,
    familyUnit: mockFamily,
    facility: mockFacility,
    doctor: mockDoctor,
    servicePackage: mockPackage,
    members: [
      {
        id: 'member-1',
        contractId: 'contract-uuid-1',
        patientId: 'patient-1',
        patient: {
          id: 'patient-1',
          fullName: 'Nguyễn Văn Con',
          dateOfBirth: new Date('2018-05-10'),
          gender: 'MALE',
          relationshipToHead: 'CON',
        },
      },
      {
        id: 'member-2',
        contractId: 'contract-uuid-1',
        patientId: 'patient-2',
        patient: {
          id: 'patient-2',
          fullName: 'Trần Thị Mẹ',
          dateOfBirth: new Date('1985-09-20'),
          gender: 'FEMALE',
          relationshipToHead: 'VO',
        },
      },
    ],
    signatures: [
      {
        id: 'sig-1',
        contractId: 'contract-uuid-1',
        signerRole: 'FAMILY_REP',
        signerUserId: 'user-rep-1',
        termsHash: 'hash-abc',
        signedAt: new Date(),
      },
    ],
    invoices: [
      {
        id: 'inv-1',
        contractId: 'contract-uuid-1',
        amount: '12000000',
        paymentStatus: 'PENDING',
      },
    ],
  };

  beforeEach(async () => {
    sessionMock = {
      findFacilityByUserId: jest.fn().mockImplementation((userId: string) => {
        if (userId === 'facility-user-1') return Promise.resolve(mockFacility);
        return Promise.resolve(null);
      }),
      findDoctorByUserId: jest.fn().mockImplementation((userId: string) => {
        if (userId === 'doctor-user-1') return Promise.resolve(mockDoctor);
        return Promise.resolve(null);
      }),
      findFamilyByRepresentativeUserId: jest
        .fn()
        .mockImplementation((userId: string) => {
          if (userId === 'user-rep-1') return Promise.resolve(mockFamily);
          return Promise.resolve(null);
        }),
      listMedicalContracts: jest.fn().mockResolvedValue({
        items: [mockContractDetail],
        total: 1,
      }),
      findMedicalContractById: jest.fn().mockImplementation((id: string) => {
        if (id === 'contract-uuid-1') return Promise.resolve(mockContractDetail);
        return Promise.resolve(null);
      }),
    };

    repositoryMock = {
      transaction: jest.fn().mockImplementation((cb: (s: any) => any) => {
        return cb(sessionMock);
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ContractsController],
      providers: [
        {
          provide: CONTRACTS_SERVICE_TOKEN,
          useClass: ContractsServiceImpl,
        },
        {
          provide: CONTRACTS_REPOSITORY_TOKEN,
          useValue: repositoryMock,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    service = module.get<ContractsServiceImpl>(CONTRACTS_SERVICE_TOKEN);
    controller = module.get<ContractsController>(ContractsController);
  });

  describe('listMedicalContracts - Role-based filtering', () => {
    it('FAMILY_REP: filters automatically by user familyUnitId', async () => {
      const result = await service.listMedicalContracts(familyRepUser, {
        page: 1,
        limit: 10,
      });

      expect(sessionMock.listMedicalContracts).toHaveBeenCalledWith(
        expect.objectContaining({ familyId: 'fam-uuid-1' }),
        0,
        10,
      );
      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(10);
    });

    it('HEALTHCARE_FACILITY: filters automatically by user facilityId', async () => {
      const result = await service.listMedicalContracts(facilityUser, {
        page: 1,
        limit: 10,
      });

      expect(sessionMock.findFacilityByUserId).toHaveBeenCalledWith(
        facilityUser.id,
      );
      expect(sessionMock.listMedicalContracts).toHaveBeenCalledWith(
        expect.objectContaining({ facilityId: 'fac-1' }),
        0,
        10,
      );
      expect(result.items).toHaveLength(1);
    });

    it('DOCTOR: filters automatically by user doctorId', async () => {
      const result = await service.listMedicalContracts(doctorUser, {
        page: 1,
        limit: 10,
      });

      expect(sessionMock.findDoctorByUserId).toHaveBeenCalledWith(
        doctorUser.id,
      );
      expect(sessionMock.listMedicalContracts).toHaveBeenCalledWith(
        expect.objectContaining({ doctorId: 'doc-1' }),
        0,
        10,
      );
      expect(result.items).toHaveLength(1);
    });

    it('ADMIN: can query all contracts and filter by status and facilityId', async () => {
      const result = await service.listMedicalContracts(adminUser, {
        page: 2,
        limit: 5,
        status: 'PENDING_APPROVAL' as any,
        facilityId: 'fac-1',
      });

      expect(sessionMock.listMedicalContracts).toHaveBeenCalledWith(
        expect.objectContaining({
          contractStatus: 'PENDING_APPROVAL',
          facilityId: 'fac-1',
        }),
        5,
        5,
      );
      expect(result.page).toBe(2);
      expect(result.limit).toBe(5);
    });

    it('returns empty list if facility user is not associated with any facility', async () => {
      const unlinkedFacilityUser: AuthenticatedUser = {
        id: 'unlinked-facility',
        role: 'HEALTHCARE_FACILITY',
        familyUnitId: null,
      };

      const result = await service.listMedicalContracts(unlinkedFacilityUser, {});
      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
      expect(sessionMock.listMedicalContracts).not.toHaveBeenCalled();
    });

    it('returns empty list if doctor user is not associated with any doctor profile', async () => {
      const unlinkedDoctorUser: AuthenticatedUser = {
        id: 'unlinked-doctor',
        role: 'DOCTOR',
        familyUnitId: null,
      };

      const result = await service.listMedicalContracts(unlinkedDoctorUser, {});
      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
      expect(sessionMock.listMedicalContracts).not.toHaveBeenCalled();
    });
  });

  describe('findMedicalContractById - Permissions & Relations', () => {
    it('returns detailed contract for ADMIN', async () => {
      const result = await service.findMedicalContractById(
        adminUser,
        'contract-uuid-1',
      );

      expect(result.id).toBe('contract-uuid-1');
      expect(result.familyUnit).toBeDefined();
      expect(result.facility).toBeDefined();
      expect(result.doctor).toBeDefined();
      expect(result.servicePackage).toBeDefined();
      expect(result.members).toHaveLength(2);
      expect(result.signatures).toHaveLength(1);
      expect(result.invoices).toHaveLength(1);
    });

    it('returns contract for associated FAMILY_REP', async () => {
      const result = await service.findMedicalContractById(
        familyRepUser,
        'contract-uuid-1',
      );
      expect(result.id).toBe('contract-uuid-1');
    });

    it('returns contract for associated HEALTHCARE_FACILITY', async () => {
      const result = await service.findMedicalContractById(
        facilityUser,
        'contract-uuid-1',
      );
      expect(result.id).toBe('contract-uuid-1');
    });

    it('returns contract for assigned DOCTOR', async () => {
      const result = await service.findMedicalContractById(
        doctorUser,
        'contract-uuid-1',
      );
      expect(result.id).toBe('contract-uuid-1');
    });

    it('throws ForbiddenException if non-party FAMILY_REP attempts to view contract', async () => {
      await expect(
        service.findMedicalContractById(otherFamilyRepUser, 'contract-uuid-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException if non-party HEALTHCARE_FACILITY attempts to view contract', async () => {
      await expect(
        service.findMedicalContractById(otherFacilityUser, 'contract-uuid-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException if unassigned DOCTOR attempts to view contract', async () => {
      await expect(
        service.findMedicalContractById(otherDoctorUser, 'contract-uuid-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException if contract does not exist', async () => {
      await expect(
        service.findMedicalContractById(adminUser, 'non-existent-contract'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('ContractsController HTTP Endpoints', () => {
    it('GET /api/v1/contracts/medical calls service.listMedicalContracts', async () => {
      const req: any = { user: familyRepUser };
      const query: ListMedicalContractsQueryDto = { page: 1, limit: 10 };

      const result = await controller.listMedicalContracts(req, query);
      expect(result).toBeDefined();
      expect(result.items).toHaveLength(1);
    });

    it('GET /api/v1/contracts/medical/:id calls service.findMedicalContractById', async () => {
      const req: any = { user: adminUser };
      const result = await controller.findMedicalContractById(
        req,
        'contract-uuid-1',
      );
      expect(result.id).toBe('contract-uuid-1');
    });
  });
});
