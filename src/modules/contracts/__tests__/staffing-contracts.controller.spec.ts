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
    status: B2bContractStatus.PENDING_FACILITY_SIGNATURE,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    service = {
      createInitialMedicalContract: jest.fn(),
      signInitialMedicalContract: jest.fn(),
      createStaffingContract: jest.fn().mockResolvedValue(mockStaffingContract),
      updateStaffingContract: jest.fn().mockResolvedValue(mockStaffingContract),
      signStaffingContract: jest.fn().mockResolvedValue({
        ...mockStaffingContract,
        status: B2bContractStatus.ACTIVE,
      }),
      requestStaffingRevision: jest.fn().mockResolvedValue({
        ...mockStaffingContract,
        status: B2bContractStatus.REVISION_REQUESTED,
      }),
      rejectStaffingContract: jest.fn().mockResolvedValue({
        ...mockStaffingContract,
        status: B2bContractStatus.REVISION_REQUESTED,
      }),
      getStaffingSigningSession: jest.fn().mockResolvedValue({
        contractId: 'stf-uuid-1',
        contractCode: 'STF-2026-TEST1234',
        status: B2bContractStatus.PENDING_FACILITY_SIGNATURE,
        signerRole: 'ADMIN',
        alreadySigned: false,
        canSign: false,
        signingToken: null,
        signingUrl: null,
        facilitySigned: false,
        adminSigned: false,
        signedPdfUrl: null,
      }),
      syncStaffingDocumensoEnvelope: jest.fn().mockResolvedValue({
        synced: true,
        contractId: 'stf-uuid-1',
        status: B2bContractStatus.ACTIVE,
        facilitySigned: true,
        adminSigned: true,
        signedPdfUrl: '/api/v1/contracts/staffing/stf-uuid-1/signed-pdf',
      }),
      downloadStaffingSignedPdf: jest.fn().mockResolvedValue({
        buffer: Buffer.from('%PDF-1.4'),
        filename: 'STF-2026-TEST1234-signed.pdf',
      }),
      getStaffingTerminationImpact: jest.fn().mockResolvedValue({
        contractId: 'stf-uuid-1',
        facilityId: 'fac-uuid-1',
        status: B2bContractStatus.ACTIVE,
        activeMedicalContracts: 0,
        pendingMedicalContracts: 0,
        openEncounters: 0,
        unsettledSettlements: 0,
        unsettledPaidInvoices: 0,
        activeOrOnboardingDoctors: 0,
        openComplaints: 0,
        hasBlockingDependencies: false,
        warnings: [],
      }),
      requestStaffingTermination: jest.fn().mockResolvedValue({
        ...mockStaffingContract,
        status: B2bContractStatus.ACTIVE,
        terminationRequestStatus: 'PENDING',
      }),
      terminateStaffingContract: jest.fn().mockResolvedValue({
        ...mockStaffingContract,
        status: B2bContractStatus.TERMINATED,
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
      listMedicalContracts: jest.fn(),
      findMedicalContractById: jest.fn(),
      getCareNeedsSummary: jest.fn(),
      getContractDocument: jest.fn(),
      cancelDraftMedicalContract: jest.fn(),
      getSigningSession: jest.fn(),
      syncDocumensoEnvelope: jest.fn(),
      downloadSignedPdf: jest.fn(),
      getFamilyGateStatus: jest.fn(),
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

  describe('createStaffingContract & updateStaffingContract', () => {
    it('should delegate createStaffingContract', async () => {
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

    it('should delegate updateStaffingContract', async () => {
      const dto = { platformCommissionRate: 12, facilityRevenueRate: 88 };
      await controller.updateStaffingContract(mockReq, 'stf-uuid-1', dto);
      expect(service.updateStaffingContract).toHaveBeenCalledWith(
        mockAdminUser,
        'stf-uuid-1',
        dto,
        '127.0.0.1',
      );
    });
  });

  describe('signStaffingContract, requestStaffingRevision & Documenso endpoints', () => {
    it('should delegate signStaffingContract', async () => {
      const signDto = { signedPdfUrl: 'https://cdn.famidoc.vn/signed.pdf' };
      const result = await controller.signStaffingContract(
        mockReq,
        'stf-uuid-1',
        signDto,
      );
      expect(result.status).toBe(B2bContractStatus.ACTIVE);
    });

    it('should delegate requestStaffingRevision & rejectStaffingContract', async () => {
      const rejectDto = {
        rejectionReason: 'Đề xuất thay đổi tỷ lệ hoa hồng nền tảng thành 10%.',
      };
      const result = await controller.requestStaffingRevision(
        mockReq,
        'stf-uuid-1',
        rejectDto,
      );
      expect(result.status).toBe(B2bContractStatus.REVISION_REQUESTED);
      expect(service.requestStaffingRevision).toHaveBeenCalledWith(
        mockAdminUser,
        'stf-uuid-1',
        rejectDto,
        '127.0.0.1',
      );
    });

    it('should delegate Documenso signing session & sync', async () => {
      await controller.getStaffingSigningSession(mockReq, 'stf-uuid-1');
      expect(service.getStaffingSigningSession).toHaveBeenCalledWith(
        mockAdminUser,
        'stf-uuid-1',
      );

      await controller.syncStaffingDocumensoEnvelope(mockReq, 'stf-uuid-1');
      expect(service.syncStaffingDocumensoEnvelope).toHaveBeenCalledWith(
        mockAdminUser,
        'stf-uuid-1',
        '127.0.0.1',
      );
    });
  });

  describe('Termination impact, request & approve', () => {
    it('delegates impact, request, and terminate', async () => {
      await controller.getStaffingTerminationImpact(mockReq, 'stf-uuid-1');
      expect(service.getStaffingTerminationImpact).toHaveBeenCalledWith(
        mockAdminUser,
        'stf-uuid-1',
      );

      await controller.requestStaffingTermination(mockReq, 'stf-uuid-1', {
        reason: 'Tạm ngưng hoạt động hợp tác',
      });
      expect(service.requestStaffingTermination).toHaveBeenCalled();

      await controller.terminateStaffingContract(mockReq, 'stf-uuid-1', {
        reason: 'Chấm dứt hợp đồng B2B theo thỏa thuận',
      });
      expect(service.terminateStaffingContract).toHaveBeenCalled();
    });
  });

  describe('listStaffingContracts & getStaffingContract', () => {
    it('should delegate to service.listStaffingContracts', async () => {
      const query = { page: 1, limit: 10 };
      const result = await controller.listStaffingContracts(mockReq, query);
      expect(result.items).toHaveLength(1);
    });

    it('should delegate to service.getStaffingContract', async () => {
      const result = await controller.getStaffingContract(
        mockReq,
        'stf-uuid-1',
      );
      expect(result).toBe(mockStaffingContract);
    });
  });
});
