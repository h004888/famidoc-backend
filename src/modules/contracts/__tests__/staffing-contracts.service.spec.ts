import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ContractsServiceImpl } from '../services/impl/contracts.service.impl';
import {
  CONTRACTS_REPOSITORY_TOKEN,
  IContractsRepository,
  ContractsSession,
} from '../repositories/interfaces/contracts.repository.interface';
import { ContractPdfRendererService } from '../services/contract-pdf-renderer.service';
import { DocumensoClientService } from '../services/documenso-client.service';
import { DocumensoSyncService } from '../services/documenso-sync.service';
import type { AuthenticatedUser } from '../../../core/auth/authenticated-request';

describe('ContractsServiceImpl - Staffing Contracts', () => {
  let service: ContractsServiceImpl;
  let sessionMock: Partial<jest.Mocked<ContractsSession>>;
  let repositoryMock: Partial<IContractsRepository>;
  let documensoClientMock: Partial<jest.Mocked<DocumensoClientService>>;
  let documensoSyncMock: Partial<jest.Mocked<DocumensoSyncService>>;
  let pdfRendererMock: Partial<jest.Mocked<ContractPdfRendererService>>;

  const adminUser: AuthenticatedUser = {
    id: 'admin-uuid-1',
    role: 'ADMIN',
    email: 'admin@famidoc.vn',
    familyUnitId: null,
  };

  const facilityUser: AuthenticatedUser = {
    id: 'facility-user-uuid-1',
    role: 'HEALTHCARE_FACILITY',
    email: 'facility@hoanmy.vn',
    familyUnitId: null,
  };

  const doctorUser: AuthenticatedUser = {
    id: 'doctor-user-uuid-1',
    role: 'DOCTOR',
    familyUnitId: null,
  };

  const mockFacility = {
    id: 'fac-uuid-1',
    userId: 'facility-user-uuid-1',
    facilityName: 'Bệnh viện Đa khoa Quốc tế Hoàn Mỹ',
    licenseNumber: 'GPHN-9999/BYT',
    taxCode: '0102030405',
    address: 'Số 100 Trần Hưng Đạo, Hà Nội',
    hotline: '1900 8888',
    bankName: 'Vietcombank',
    bankAccountNumber: '001100223344',
    bankAccountHolder: 'BV HOAN MY',
    verificationStatus: 'ACTIVE' as const,
    user: {
      id: 'facility-user-uuid-1',
      email: 'facility@hoanmy.vn',
      fullName: 'Đại diện Hoàn Mỹ',
      phone: '0901234567',
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockStaffingContract = {
    id: 'stf-uuid-1',
    contractCode: 'STF-2026-TEST1234',
    facilityId: 'fac-uuid-1',
    platformCommissionRate: new Prisma.Decimal(15.0),
    facilityRevenueRate: new Prisma.Decimal(85.0),
    startDate: new Date('2026-01-01'),
    endDate: new Date('2099-12-31'),
    signedPdfUrl: null,
    signedPdfKey: null,
    contractTerms: 'Điều khoản B2B chuẩn',
    revisionReason: null,
    documensoEnvelopeId: 'env-1',
    documensoItemId: 'item-1',
    facilityDocumensoRecipientId: 101,
    facilitySigningUrl: 'https://documenso.local/sign/fac-token',
    facilitySigningToken: 'fac-token',
    adminDocumensoRecipientId: 102,
    adminSigningUrl: 'https://documenso.local/sign/adm-token',
    adminSigningToken: 'adm-token',
    facilitySignedAt: null,
    adminSignedAt: null,
    terminationRequestStatus: null,
    terminationRequestReason: null,
    terminationRequestedAt: null,
    terminatedByUserId: null,
    terminatedReason: null,
    terminatedAt: null,
    status: 'PENDING_FACILITY_SIGNATURE' as const,
    createdAt: new Date(),
    updatedAt: new Date(),
    facility: mockFacility,
  };

  const zeroImpact = {
    activeMedicalContracts: 0,
    pendingMedicalContracts: 0,
    openEncounters: 0,
    unsettledSettlements: 0,
    unsettledPaidInvoices: 0,
    activeOrOnboardingDoctors: 0,
    openComplaints: 0,
  };

  beforeEach(async () => {
    sessionMock = {
      findFacilityById: jest.fn().mockResolvedValue(mockFacility as any),
      findActiveStaffingContract: jest.fn().mockImplementation((facilityId: string) =>
        Promise.resolve(
          facilityId === mockFacility.id
            ? ({ id: 'staffing-1', facilityId, status: 'ACTIVE' } as any)
            : null,
        ),
      ),
      findFacilityByUserId: jest.fn().mockResolvedValue(mockFacility as any),
      findFirstActiveAdminUser: jest.fn().mockResolvedValue({
        id: 'admin-uuid-1',
        email: 'admin@famidoc.vn',
        fullName: 'Quản trị viên FamiDoc',
      }),
      findConflictingStaffingContract: jest.fn().mockResolvedValue(null),
      createStaffingContract: jest
        .fn()
        .mockImplementation((data) =>
          Promise.resolve({ ...mockStaffingContract, ...data }),
        ),
      findStaffingContract: jest
        .fn()
        .mockResolvedValue(mockStaffingContract as any),
      lockStaffingContractForUpdate: jest
        .fn()
        .mockResolvedValue(mockStaffingContract as any),
      updateStaffingContract: jest
        .fn()
        .mockImplementation((_id, data) =>
          Promise.resolve({ ...mockStaffingContract, ...data }),
        ),
      updateStaffingContractStatus: jest
        .fn()
        .mockImplementation((_id, status, signedPdfUrl) =>
          Promise.resolve({
            ...mockStaffingContract,
            status,
            ...(signedPdfUrl ? { signedPdfUrl } : {}),
          }),
        ),
      getStaffingTerminationImpact: jest.fn().mockResolvedValue(zeroImpact),
      listStaffingContracts: jest.fn().mockResolvedValue({
        items: [mockStaffingContract as any],
        total: 1,
      }),
      recordStaffingAudit: jest.fn().mockResolvedValue(undefined),
      findAdminUsers: jest.fn().mockResolvedValue([{ id: 'admin-uuid-1' }]),
      createNotification: jest.fn().mockResolvedValue(undefined),
    };

    repositoryMock = {
      transaction: jest.fn().mockImplementation((cb) => cb(sessionMock)),
    };

    documensoClientMock = {
      isConfigured: jest.fn().mockReturnValue(false),
      createTwoPartyEnvelope: jest.fn().mockResolvedValue({
        envelopeId: 'env-new',
        envelopeItemId: 'item-new',
        signers: [
          {
            role: 'HEALTHCARE_FACILITY',
            recipientId: 101,
            token: 'fac-tok',
            signingUrl: 'https://documenso.local/sign/fac-tok',
          },
          {
            role: 'ADMIN',
            recipientId: 102,
            token: 'adm-tok',
            signingUrl: 'https://documenso.local/sign/adm-tok',
          },
        ],
      }),
      deleteEnvelope: jest.fn().mockResolvedValue(undefined),
      downloadSignedItemPdf: jest
        .fn()
        .mockResolvedValue(Buffer.from('%PDF-1.4-mock')),
    };

    documensoSyncMock = {
      syncStaffingContractFromDocumenso: jest.fn().mockResolvedValue({
        synced: true,
        contractId: 'stf-uuid-1',
        status: 'ACTIVE',
        facilitySigned: true,
        adminSigned: true,
        signedPdfUrl: '/api/v1/contracts/staffing/stf-uuid-1/signed-pdf',
      }),
    };

    pdfRendererMock = {
      renderPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4-draft')),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContractsServiceImpl,
        {
          provide: CONTRACTS_REPOSITORY_TOKEN,
          useValue: repositoryMock,
        },
        {
          provide: DocumensoClientService,
          useValue: documensoClientMock,
        },
        {
          provide: DocumensoSyncService,
          useValue: documensoSyncMock,
        },
        {
          provide: ContractPdfRendererService,
          useValue: pdfRendererMock,
        },
      ],
    }).compile();

    service = module.get<ContractsServiceImpl>(ContractsServiceImpl);
  });

  describe('createStaffingContract', () => {
    const validDto = {
      facilityId: 'fac-uuid-1',
      platformCommissionRate: 15.0,
      facilityRevenueRate: 85.0,
      startDate: '2026-01-01',
      endDate: '2099-12-31',
    };

    it('allows ADMIN to create staffing contract in PENDING_FACILITY_SIGNATURE and notifies facility', async () => {
      documensoClientMock.isConfigured!.mockReturnValue(true);

      const result = await service.createStaffingContract(
        adminUser,
        validDto,
        '127.0.0.1',
      );

      expect(result).toBeDefined();
      expect(result.contractCode).toMatch(/^STF-/);
      expect(result.status).toBe('PENDING_FACILITY_SIGNATURE');
      expect(result.contractTerms).toBeNull();
      expect(result.platformLegal?.companyName).toBeTruthy();
      expect(pdfRendererMock.renderPdf).toHaveBeenCalledTimes(1);
      expect(documensoClientMock.createTwoPartyEnvelope).toHaveBeenCalledWith(
        expect.objectContaining({
          recipients: expect.arrayContaining([
            expect.objectContaining({ role: 'HEALTHCARE_FACILITY' }),
            expect.objectContaining({ role: 'ADMIN' }),
          ]),
        }),
      );
      expect(sessionMock.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: mockFacility.userId,
          type: 'STAFFING_CONTRACT_CREATED',
        }),
      );
    });

    it('rejects HEALTHCARE_FACILITY or DOCTOR attempting to create B2B contract', async () => {
      await expect(
        service.createStaffingContract(facilityUser, validDto, '127.0.0.1'),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.createStaffingContract(doctorUser, validDto, '127.0.0.1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects rates not summing to 100%', async () => {
      await expect(
        service.createStaffingContract(
          adminUser,
          { ...validDto, platformCommissionRate: 20, facilityRevenueRate: 70 },
          '127.0.0.1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects invalid date range', async () => {
      await expect(
        service.createStaffingContract(
          adminUser,
          { ...validDto, startDate: '2026-12-31', endDate: '2026-01-01' },
          '127.0.0.1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException when conflicting staffing contract exists', async () => {
      sessionMock.findConflictingStaffingContract!.mockResolvedValue(
        mockStaffingContract as any,
      );
      await expect(
        service.createStaffingContract(adminUser, validDto, '127.0.0.1'),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('Sequential signing & Documenso endpoints', () => {
    it('moves contract from PENDING_FACILITY_SIGNATURE to PENDING_ADMIN_SIGNATURE when facility signs first', async () => {
      const result = await service.signStaffingContract(
        facilityUser,
        'stf-uuid-1',
        {},
        '127.0.0.1',
      );

      expect(result.status).toBe('PENDING_ADMIN_SIGNATURE');
      expect(sessionMock.updateStaffingContract).toHaveBeenCalledWith(
        'stf-uuid-1',
        expect.objectContaining({ status: 'PENDING_ADMIN_SIGNATURE' }),
      );
      expect(sessionMock.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'admin-uuid-1',
          type: 'STAFFING_CONTRACT_FACILITY_SIGNED',
        }),
      );
    });

    it('blocks ADMIN from signing while still PENDING_FACILITY_SIGNATURE', async () => {
      await expect(
        service.signStaffingContract(
          adminUser,
          'stf-uuid-1',
          { signedPdfUrl: 'https://cdn.famidoc.vn/signed.pdf' },
          '127.0.0.1',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('allows ADMIN to sign PENDING_ADMIN_SIGNATURE and activate contract', async () => {
      sessionMock.lockStaffingContractForUpdate!.mockResolvedValue({
        ...mockStaffingContract,
        status: 'PENDING_ADMIN_SIGNATURE' as const,
        facilitySignedAt: new Date(),
      } as any);

      const result = await service.signStaffingContract(
        adminUser,
        'stf-uuid-1',
        { signedPdfUrl: 'https://cdn.famidoc.vn/signed.pdf' },
        '127.0.0.1',
      );

      expect(result.status).toBe('ACTIVE');
      expect(sessionMock.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: mockFacility.userId,
          type: 'STAFFING_CONTRACT_ACTIVE',
        }),
      );
    });

    it('returns correct signing session per role and waitingReason before facility signs', async () => {
      const facilitySession = await service.getStaffingSigningSession(
        facilityUser,
        'stf-uuid-1',
      );
      expect(facilitySession.canSign).toBe(true);
      expect(facilitySession.signingToken).toBe('fac-token');

      const adminSession = await service.getStaffingSigningSession(
        adminUser,
        'stf-uuid-1',
      );
      expect(adminSession.canSign).toBe(false);
      expect(adminSession.signingToken).toBeNull();
      expect(adminSession.waitingReason).toContain('Cơ sở y tế ký bước 1');
    });

    it('enforces dual signatures before allowing signed PDF download', async () => {
      await expect(
        service.downloadStaffingSignedPdf(adminUser, 'stf-uuid-1'),
      ).rejects.toThrow(ConflictException);

      sessionMock.findStaffingContract!.mockResolvedValue({
        ...mockStaffingContract,
        status: 'ACTIVE' as const,
        facilitySignedAt: new Date(),
        adminSignedAt: new Date(),
      } as any);

      const pdf = await service.downloadStaffingSignedPdf(
        adminUser,
        'stf-uuid-1',
      );
      expect(pdf.buffer.toString()).toContain('%PDF-1.4');
    });
  });

  describe('In-place Revision Loop (requestStaffingRevision -> updateStaffingContract)', () => {
    it('transitions contract to REVISION_REQUESTED, deletes old Documenso envelope, and notifies Admin', async () => {
      const result = await service.requestStaffingRevision(
        facilityUser,
        'stf-uuid-1',
        { reason: 'Cần điều chỉnh tỷ lệ phân chia doanh thu lên 87%.' },
        '127.0.0.1',
      );

      expect(result.status).toBe('REVISION_REQUESTED');
      expect(documensoClientMock.deleteEnvelope).toHaveBeenCalledWith('env-1');
      expect(sessionMock.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'admin-uuid-1',
          type: 'STAFFING_CONTRACT_REVISION_REQUESTED',
        }),
      );
    });

    it('allows Admin to update the same contract in-place and re-issue Documenso envelope', async () => {
      documensoClientMock.isConfigured!.mockReturnValue(true);
      sessionMock.findStaffingContract!.mockResolvedValue({
        ...mockStaffingContract,
        status: 'REVISION_REQUESTED' as const,
        revisionReason: 'Điều chỉnh tỷ lệ',
        documensoEnvelopeId: null,
      } as any);

      const result = await service.updateStaffingContract(
        adminUser,
        'stf-uuid-1',
        {
          platformCommissionRate: 13,
          facilityRevenueRate: 87,
          contractTerms: 'Điều khoản mới 87/13',
        },
        '127.0.0.1',
      );

      expect(result.status).toBe('PENDING_FACILITY_SIGNATURE');
      expect(result.revisionReason).toBeNull();
      expect(documensoClientMock.createTwoPartyEnvelope).toHaveBeenCalledTimes(
        1,
      );
      expect(sessionMock.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: mockFacility.userId,
          type: 'STAFFING_CONTRACT_REVISED',
        }),
      );
    });

    it('rejects Admin update after facility has signed or contract is ACTIVE', async () => {
      sessionMock.findStaffingContract!.mockResolvedValue({
        ...mockStaffingContract,
        status: 'PENDING_ADMIN_SIGNATURE' as const,
      } as any);

      await expect(
        service.updateStaffingContract(
          adminUser,
          'stf-uuid-1',
          { platformCommissionRate: 10, facilityRevenueRate: 90 },
          '127.0.0.1',
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('Controlled Termination & Impact Check', () => {
    it('allows Admin to cancel pre-activation draft and delete Documenso envelope', async () => {
      const result = await service.terminateStaffingContract(
        adminUser,
        'stf-uuid-1',
        { reason: 'Hủy dự thảo do thay đổi kế hoạch hợp tác' },
        '127.0.0.1',
      );

      expect(result.status).toBe('TERMINATED');
      expect(documensoClientMock.deleteEnvelope).toHaveBeenCalledWith('env-1');
    });

    it('allows facility to submit termination request on ACTIVE contract without terminating it', async () => {
      const activeContract = {
        ...mockStaffingContract,
        status: 'ACTIVE' as const,
      };
      sessionMock.lockStaffingContractForUpdate!.mockResolvedValue(
        activeContract as any,
      );
      sessionMock.updateStaffingContract!.mockImplementationOnce((_id, data) =>
        Promise.resolve({ ...activeContract, ...data } as any),
      );

      const result = await service.requestStaffingTermination(
        facilityUser,
        'stf-uuid-1',
        { reason: 'Cơ sở y tế tạm ngưng mô hình bác sĩ gia đình' },
        '127.0.0.1',
      );

      expect(result.status).toBe('ACTIVE');
      expect(result.terminationRequestStatus).toBe('PENDING');
      expect(sessionMock.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'admin-uuid-1',
          type: 'STAFFING_CONTRACT_TERMINATION_REQUESTED',
        }),
      );
    });

    it('blocks ACTIVE termination with 409 when blocking dependencies exist unless force=true + handoverNotes', async () => {
      sessionMock.lockStaffingContractForUpdate!.mockResolvedValue({
        ...mockStaffingContract,
        status: 'ACTIVE' as const,
      } as any);
      sessionMock.getStaffingTerminationImpact!.mockResolvedValue({
        ...zeroImpact,
        activeMedicalContracts: 2,
        openEncounters: 1,
      });

      await expect(
        service.terminateStaffingContract(
          adminUser,
          'stf-uuid-1',
          { reason: 'Chấm dứt hợp đồng B2B' },
          '127.0.0.1',
        ),
      ).rejects.toThrow(ConflictException);

      await expect(
        service.terminateStaffingContract(
          adminUser,
          'stf-uuid-1',
          { reason: 'Chấm dứt hợp đồng B2B', force: true },
          '127.0.0.1',
        ),
      ).rejects.toThrow(BadRequestException);

      const forced = await service.terminateStaffingContract(
        adminUser,
        'stf-uuid-1',
        {
          reason: 'Chấm dứt hợp đồng B2B',
          force: true,
          handoverNotes: 'Đã bàn giao 2 hộ gia đình cho BV Bạch Mai',
        },
        '127.0.0.1',
      );
      expect(forced.status).toBe('TERMINATED');
    });

    it('returns non-blocking settlements/doctors/complaints warnings on impact check', async () => {
      sessionMock.getStaffingTerminationImpact!.mockResolvedValue({
        ...zeroImpact,
        unsettledSettlements: 1,
        activeOrOnboardingDoctors: 3,
      });

      const impact = await service.getStaffingTerminationImpact(
        adminUser,
        'stf-uuid-1',
      );
      expect(impact.hasBlockingDependencies).toBe(false);
      expect(impact.warnings).toHaveLength(2);
    });
  });

  describe('listStaffingContracts & getStaffingContract', () => {
    it('lists staffing contracts for ADMIN', async () => {
      const result = await service.listStaffingContracts(adminUser, {
        page: 1,
        limit: 10,
      });
      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it('gets single staffing contract detail', async () => {
      const result = await service.getStaffingContract(adminUser, 'stf-uuid-1');
      expect(result.id).toBe('stf-uuid-1');
    });
  });
});
