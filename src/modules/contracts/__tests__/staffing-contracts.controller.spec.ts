import { Test, TestingModule } from '@nestjs/testing';
import { ContractsController } from '../controllers/contracts.controller';
import {
  CONTRACTS_SERVICE_TOKEN,
  IContractsService,
} from '../services/interfaces/contracts.service.interface';
import { JwtAuthGuard } from '../../../core/auth/jwt-auth.guard';
import { RolesGuard } from '../../../core/auth/roles.guard';
import type { AuthenticatedRequest } from '../../../core/auth/authenticated-request';
import { B2bContractStatus } from '@prisma/client';

describe('ContractsController - Staffing Endpoints', () => {
  let controller: ContractsController;
  let service: jest.Mocked<IContractsService>;

  const mockAdminUser = {
    id: 'admin-1',
    role: 'ADMIN' as const,
    email: 'admin@famidoc.vn',
  };

  const mockReq = {
    user: mockAdminUser,
    ip: '127.0.0.1',
  } as unknown as AuthenticatedRequest;

  const mockStaffingContract = {
    id: 'stf-uuid-1',
    contractCode: 'STF-2026-TEST1234',
    facilityId: 'fac-uuid-1',
    platformCommissionRate: 15.0,
    facilityRevenueRate: 85.0,
    startDate: new Date('2026-01-01'),
    endDate: new Date('2026-12-31'),
    signedPdfUrl: null,
    status: B2bContractStatus.PENDING_SIGNATURE,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    service = {
      createInitialMedicalContract: jest.fn(),
      signInitialMedicalContract: jest.fn(),
      createStaffingContract: jest.fn().mockResolvedValue(mockStaffingContract),
      signStaffingContract: jest.fn().mockResolvedValue({
        ...mockStaffingContract,
        status: B2bContractStatus.ACTIVE,
      }),
      listStaffingContracts: jest.fn().mockResolvedValue({
        items: [mockStaffingContract],
        total: 1,
      }),
      getStaffingContract: jest.fn().mockResolvedValue(mockStaffingContract),
      createContractAddendum: jest.fn(),
      createPackageUpgradeContract: jest.fn(),
      terminateContract: jest.fn(),
      getContractChangeTerms: jest.fn(),
      signContractAddendum: jest.fn(),
      signUpgradedContract: jest.fn(),
      initiateFourPartyContract: jest.fn(),
      signFourPartyContract: jest.fn(),
      assignDoctorToPackage: jest.fn(),
      createInitialMedicalContract: jest.fn(),
      signInitialMedicalContract: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
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

    controller = module.get<ContractsController>(ContractsController);
  });

  describe('createStaffingContract (STT 13)', () => {
    it('should delegate to service.createStaffingContract', async () => {
      const dto = {
        facilityId: 'fac-uuid-1',
        platformCommissionRate: 15.0,
        facilityRevenueRate: 85.0,
        startDate: '2026-01-01',
        endDate: '2026-12-31',
      };

      const result = await controller.createStaffingContract(mockReq, dto);

      expect(result).toBe(mockStaffingContract);
      expect(service.createStaffingContract).toHaveBeenCalledWith(
        mockAdminUser,
        dto,
        '127.0.0.1',
      );
    });
  });

  describe('signStaffingContract (STT 14)', () => {
    it('should delegate to service.signStaffingContract', async () => {
      const signDto = {
        signedPdfUrl: 'https://cdn.famidoc.vn/signed.pdf',
      };

      const result = await controller.signStaffingContract(
        mockReq,
        'stf-uuid-1',
        signDto,
      );

      expect(result.status).toBe(B2bContractStatus.ACTIVE);
      expect(service.signStaffingContract).toHaveBeenCalledWith(
        mockAdminUser,
        'stf-uuid-1',
        signDto,
        '127.0.0.1',
      );
    });
  });

  describe('listStaffingContracts & getStaffingContract', () => {
    it('should delegate to service.listStaffingContracts', async () => {
      const query = { page: 1, limit: 10 };
      const result = await controller.listStaffingContracts(mockReq, query);

      expect(result.items).toHaveLength(1);
      expect(service.listStaffingContracts).toHaveBeenCalledWith(
        mockAdminUser,
        query,
      );
    });

    it('should delegate to service.getStaffingContract', async () => {
      const result = await controller.getStaffingContract(
        mockReq,
        'stf-uuid-1',
      );

      expect(result).toBe(mockStaffingContract);
      expect(service.getStaffingContract).toHaveBeenCalledWith(
        mockAdminUser,
        'stf-uuid-1',
      );
    });
  });

  describe('Termination Aliases (UC-19)', () => {
    it('should delegate requestTermination to service.terminateContract with action REQUEST', async () => {
      const dto = {
        reason: 'Gia đình chuyển nơi sinh sống sang tỉnh khác',
      };

      await (controller as any).requestTermination(
        mockReq,
        'contract-uuid-1',
        dto,
      );

      expect(service.terminateContract).toHaveBeenCalledWith(
        mockAdminUser,
        'contract-uuid-1',
        expect.objectContaining({
          action: 'REQUEST',
          reason: dto.reason,
        }),
      );
    });

    it('should delegate decideTermination to service.terminateContract with decision body', async () => {
      const decisionDto = {
        contractId: 'contract-uuid-1',
        action: 'APPROVE',
        termsHash: 'a'.repeat(64),
      };

      await (controller as any).decideTermination(
        mockReq,
        'req-uuid-1',
        decisionDto,
      );

      expect(service.terminateContract).toHaveBeenCalledWith(
        mockAdminUser,
        'contract-uuid-1',
        expect.objectContaining({
          action: 'APPROVE',
          requestId: 'req-uuid-1',
        }),
      );
    });
  });
});
