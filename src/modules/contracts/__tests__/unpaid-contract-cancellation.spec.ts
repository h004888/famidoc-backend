import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ContractsServiceImpl } from '../services/impl/contracts.service.impl';
import { SlotLedgerService } from '../../scheduling/slot-ledger.service';
import { ContractsController } from '../controllers/contracts.controller';
import {
  CONTRACTS_REPOSITORY_TOKEN,
  type IContractsRepository,
} from '../repositories/interfaces/contracts.repository.interface';
import { CONTRACTS_SERVICE_TOKEN } from '../services/interfaces/contracts.service.interface';
import { DocumensoClientService } from '../services/documenso-client.service';
import { ContractPdfRendererService } from '../services/contract-pdf-renderer.service';
import type { AuthenticatedUser } from '../../../core/auth/authenticated-request';
import { JwtAuthGuard } from '../../../core/auth/jwt-auth.guard';
import { RolesGuard } from '../../../core/auth/roles.guard';

describe('Unpaid contract cancellation & replacement', () => {
  let service: ContractsServiceImpl;
  let documensoService: ContractsServiceImpl;
  let controller: ContractsController;
  let sessionMock: any;
  let documensoMock: any;

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

  const otherFamilyRepUser: AuthenticatedUser = {
    id: 'user-rep-2',
    role: 'FAMILY_REP',
    familyUnitId: 'fam-uuid-2',
  };

  const facilityUser: AuthenticatedUser = {
    id: 'facility-user-1',
    role: 'HEALTHCARE_FACILITY',
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
    activePanelCount: 5,
    maxPanelCapacity: 30,
    user: { id: 'doctor-user-1' },
  };

  const mockFamily = {
    id: 'fam-uuid-1',
    familyCode: 'FAM-001',
    representativeUserId: 'user-rep-1',
    homeAddress: '123 Đường Láng, Phường Láng Thượng, Thành phố Hà Nội',
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
    documensoEnvelopeId: 'envelope-1',
    familyUnit: mockFamily,
    facility: mockFacility,
    doctor: mockDoctor,
    servicePackage: mockPackage,
  };

  beforeEach(async () => {
    sessionMock = {
      findPackage: jest.fn().mockResolvedValue(mockPackage),
      findFacilityById: jest.fn().mockResolvedValue(mockFacility),
      findActiveStaffingContract: jest.fn().mockImplementation((facilityId: string) =>
        Promise.resolve(
          facilityId === mockFacility.id
            ? { id: 'staffing-1', facilityId, status: 'ACTIVE' }
            : null,
        )
      ),
      findDoctorById: jest.fn().mockResolvedValue(mockDoctor),
      findFamilyById: jest.fn().mockResolvedValue(mockFamily),
      findFamilyByRepresentativeUserId: jest.fn().mockResolvedValue(null),
      findPatientsByIdsAndFamilyId: jest
        .fn()
        .mockResolvedValue([{ id: 'patient-1' }, { id: 'patient-2' }]),
      createContractMembers: jest.fn().mockResolvedValue(undefined),
      countFamilyMembers: jest.fn().mockResolvedValue(4),
      hasOtherActiveContract: jest.fn().mockResolvedValue(false),
      findContractForUpdate: jest.fn().mockResolvedValue(mockContract),
      findContractSignatures: jest.fn().mockResolvedValue([]),
      createMedicalContract: jest.fn().mockResolvedValue(mockContract),
      updateContractStatus: jest.fn().mockResolvedValue(undefined),
      hasPaidInvoice: jest.fn().mockResolvedValue(false),
      cancelPendingInvoices: jest.fn().mockResolvedValue(undefined),
      recordChange: jest.fn().mockResolvedValue(undefined),
      findFirstActiveAdminUser: jest.fn().mockResolvedValue(null),
    };

    documensoMock = {
      deleteEnvelope: jest.fn().mockResolvedValue(undefined),
      createFourPartyEnvelope: jest.fn().mockResolvedValue({
        envelopeId: 'envelope-new',
        envelopeItemId: 'item-new',
        signers: [
          {
            role: 'FAMILY_REP',
            recipientId: 1,
            token: 'token-1',
            signingUrl: 'https://sign.local/1',
          },
        ],
      }),
    } as any;

    const repositoryMock: Partial<IContractsRepository> = {
      transaction: jest.fn().mockImplementation(async (cb) => cb(sessionMock)),
    };

    // Luồng tạo hợp đồng chạy không kèm Documenso để không kết xuất PDF trong unit test.
    const plainModule: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: SlotLedgerService, useValue: undefined },
        ContractsServiceImpl,
        {
          provide: CONTRACTS_REPOSITORY_TOKEN,
          useValue: repositoryMock,
        },
      ],
    }).compile();
    service = plainModule.get<ContractsServiceImpl>(ContractsServiceImpl);

    const documensoModule: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: SlotLedgerService, useValue: undefined },
        ContractsServiceImpl,
        {
          provide: CONTRACTS_REPOSITORY_TOKEN,
          useValue: repositoryMock,
        },
        {
          provide: DocumensoClientService,
          useValue: documensoMock,
        },
        {
          provide: ContractPdfRendererService,
          useValue: { renderPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF')) },
        },
      ],
    }).compile();
    documensoService = documensoModule.get<ContractsServiceImpl>(
      ContractsServiceImpl,
    );

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

  describe('cancelDraftMedicalContract', () => {
    it('should terminate an unpaid PENDING_APPROVAL contract and cancel pending invoices', async () => {
      const result = await service.cancelDraftMedicalContract(
        familyRepUser,
        'contract-uuid-1',
        'Đổi gói chăm sóc khác',
      );

      expect(result).toEqual({
        id: 'contract-uuid-1',
        contractStatus: 'TERMINATED',
      });
      expect(sessionMock.updateContractStatus).toHaveBeenCalledWith(
        'contract-uuid-1',
        'TERMINATED',
        'Đổi gói chăm sóc khác',
      );
      expect(sessionMock.cancelPendingInvoices).toHaveBeenCalledWith(
        'contract-uuid-1',
      );
      expect(sessionMock.recordChange).toHaveBeenCalledWith(
        'user-rep-1',
        expect.anything(),
        'CANCEL_UNPAID_CONTRACT_DRAFT',
        'contract-uuid-1',
      );
    });

    it('should allow cancelling a PENDING_PAYMENT contract without a PAID invoice', async () => {
      sessionMock.findContractForUpdate.mockResolvedValue({
        ...mockContract,
        contractStatus: 'PENDING_PAYMENT',
      });

      await service.cancelDraftMedicalContract(
        familyRepUser,
        'contract-uuid-1',
      );

      expect(sessionMock.updateContractStatus).toHaveBeenCalledWith(
        'contract-uuid-1',
        'TERMINATED',
        expect.any(String),
      );
    });

    it('should cancel the Documenso envelope outside the transaction', async () => {
      await documensoService.cancelDraftMedicalContract(
        familyRepUser,
        'contract-uuid-1',
      );

      expect(documensoMock.deleteEnvelope).toHaveBeenCalledWith('envelope-1');
    });

    it('should allow ADMIN to cancel an unpaid draft of any household', async () => {
      await service.cancelDraftMedicalContract(adminUser, 'contract-uuid-1');

      expect(sessionMock.updateContractStatus).toHaveBeenCalledWith(
        'contract-uuid-1',
        'TERMINATED',
        expect.any(String),
      );
    });

    it('should keep the draft cancellation when Documenso rejects the delete request', async () => {
      documensoMock.deleteEnvelope.mockRejectedValue(new Error('network'));

      await expect(
        service.cancelDraftMedicalContract(familyRepUser, 'contract-uuid-1'),
      ).resolves.toEqual({
        id: 'contract-uuid-1',
        contractStatus: 'TERMINATED',
      });
      expect(sessionMock.updateContractStatus).toHaveBeenCalled();
    });

    it('should reject cancelling an ACTIVE contract with 409', async () => {
      sessionMock.findContractForUpdate.mockResolvedValue({
        ...mockContract,
        contractStatus: 'ACTIVE',
      });

      await expect(
        service.cancelDraftMedicalContract(familyRepUser, 'contract-uuid-1'),
      ).rejects.toThrow(ConflictException);
      expect(sessionMock.updateContractStatus).not.toHaveBeenCalled();
    });

    it('should reject cancelling a PENDING_PAYMENT contract that already has a PAID invoice with 409', async () => {
      sessionMock.findContractForUpdate.mockResolvedValue({
        ...mockContract,
        contractStatus: 'PENDING_PAYMENT',
      });
      sessionMock.hasPaidInvoice.mockResolvedValue(true);

      await expect(
        service.cancelDraftMedicalContract(familyRepUser, 'contract-uuid-1'),
      ).rejects.toThrow(ConflictException);
      expect(sessionMock.cancelPendingInvoices).not.toHaveBeenCalled();
    });

    it('should reject a family representative from another household with 403', async () => {
      await expect(
        service.cancelDraftMedicalContract(
          otherFamilyRepUser,
          'contract-uuid-1',
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(sessionMock.updateContractStatus).not.toHaveBeenCalled();
    });

    it('should reject a FAMILY_REP without familyUnitId when no representative family exists with 403', async () => {
      const noFamilyRep: AuthenticatedUser = {
        id: 'user-rep-orphan',
        role: 'FAMILY_REP',
        familyUnitId: null,
      };
      sessionMock.findFamilyByRepresentativeUserId.mockResolvedValue(null);

      await expect(
        service.cancelDraftMedicalContract(noFamilyRep, 'contract-uuid-1'),
      ).rejects.toThrow(ForbiddenException);
      expect(sessionMock.updateContractStatus).not.toHaveBeenCalled();
    });

    it('should resolve household via findFamilyByRepresentativeUserId when actor.familyUnitId is null', async () => {
      const repWithoutTokenFamily: AuthenticatedUser = {
        id: 'user-rep-1',
        role: 'FAMILY_REP',
        familyUnitId: null,
      };
      sessionMock.findFamilyByRepresentativeUserId.mockResolvedValue({
        id: 'fam-uuid-1',
      });

      const result = await service.cancelDraftMedicalContract(
        repWithoutTokenFamily,
        'contract-uuid-1',
      );

      expect(result).toEqual({
        id: 'contract-uuid-1',
        contractStatus: 'TERMINATED',
      });
    });

    it('should reject a role that is not FAMILY_REP or ADMIN with 403', async () => {
      await expect(
        service.cancelDraftMedicalContract(facilityUser, 'contract-uuid-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should reject an unknown contract with 404', async () => {
      sessionMock.findContractForUpdate.mockResolvedValue(null);

      await expect(
        service.cancelDraftMedicalContract(familyRepUser, 'missing'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should expose the cancel-draft endpoint through the controller', async () => {
      const mockReq: any = { user: familyRepUser };

      const result = await controller.cancelDraftMedicalContract(
        mockReq,
        'contract-uuid-1',
        { reason: 'Đổi gói' },
      );

      expect(result).toEqual({
        id: 'contract-uuid-1',
        contractStatus: 'TERMINATED',
      });
      expect(sessionMock.updateContractStatus).toHaveBeenCalledWith(
        'contract-uuid-1',
        'TERMINATED',
        'Đổi gói',
      );
    });
  });

  describe('createInitialMedicalContract with replaceContractId', () => {
    const dto = {
      packageId: 'pkg-1',
      facilityId: 'fac-1',
      doctorId: 'doc-1',
      patientIds: ['patient-1', 'patient-2'],
    };

    it('should terminate the replaced draft and then create the new contract', async () => {
      const result = await service.createInitialMedicalContract(familyRepUser, {
        ...dto,
        replaceContractId: 'contract-uuid-1',
      } as any);

      expect(result.contractStatus).toBe('PENDING_APPROVAL');
      expect(sessionMock.updateContractStatus).toHaveBeenCalledWith(
        'contract-uuid-1',
        'TERMINATED',
        expect.any(String),
      );
      expect(sessionMock.cancelPendingInvoices).toHaveBeenCalledWith(
        'contract-uuid-1',
      );
      expect(sessionMock.createMedicalContract).toHaveBeenCalled();
      // Hủy hợp đồng cũ phải chạy trước khi tạo hợp đồng mới.
      const terminateOrder =
        sessionMock.updateContractStatus.mock.invocationCallOrder[0];
      const createOrder =
        sessionMock.createMedicalContract.mock.invocationCallOrder[0];
      expect(terminateOrder).toBeLessThan(createOrder);
    });

    it('should delete the replaced Documenso envelope when documensoClient is configured', async () => {
      await documensoService.createInitialMedicalContract(familyRepUser, {
        ...dto,
        replaceContractId: 'contract-uuid-1',
      } as any);

      expect(documensoMock.deleteEnvelope).toHaveBeenCalledWith('envelope-1');
    });

    it('should reject replacing a draft from another household with 403 and not create a contract', async () => {
      await expect(
        service.createInitialMedicalContract(otherFamilyRepUser, {
          ...dto,
          replaceContractId: 'contract-uuid-1',
        } as any),
      ).rejects.toThrow(ForbiddenException);

      expect(sessionMock.createMedicalContract).not.toHaveBeenCalled();
    });

    it('should reject replacing a contract that already has a PAID invoice with 409', async () => {
      sessionMock.hasPaidInvoice.mockResolvedValue(true);

      await expect(
        service.createInitialMedicalContract(familyRepUser, {
          ...dto,
          replaceContractId: 'contract-uuid-1',
        } as any),
      ).rejects.toThrow(ConflictException);

      expect(sessionMock.createMedicalContract).not.toHaveBeenCalled();
    });

    it('should reject replacing an ACTIVE contract with 409', async () => {
      sessionMock.findContractForUpdate.mockResolvedValue({
        ...mockContract,
        contractStatus: 'ACTIVE',
      });

      await expect(
        service.createInitialMedicalContract(familyRepUser, {
          ...dto,
          replaceContractId: 'contract-uuid-1',
        } as any),
      ).rejects.toThrow(ConflictException);

      expect(sessionMock.createMedicalContract).not.toHaveBeenCalled();
    });
  });
});
