import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ContractsServiceImpl } from '../services/impl/contracts.service.impl';
import {
  CONTRACTS_REPOSITORY_TOKEN,
  IContractsRepository,
  ContractsSession,
} from '../repositories/interfaces/contracts.repository.interface';
import type { AuthenticatedUser } from '../../../core/auth/authenticated-request';
import { Prisma } from '@prisma/client';

describe('ContractsServiceImpl - Staffing Contracts', () => {
  let service: ContractsServiceImpl;
  let sessionMock: Partial<jest.Mocked<ContractsSession>>;
  let repositoryMock: Partial<IContractsRepository>;

  const adminUser: AuthenticatedUser = {
    id: 'admin-uuid-1',
    role: 'ADMIN',
    familyUnitId: null,
  };

  const facilityUser: AuthenticatedUser = {
    id: 'facility-user-uuid-1',
    role: 'HEALTHCARE_FACILITY',
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
    endDate: new Date('2026-12-31'),
    signedPdfUrl: null,
    status: 'PENDING_SIGNATURE' as const,
    createdAt: new Date(),
    updatedAt: new Date(),
    facility: mockFacility,
  };

  beforeEach(async () => {
    sessionMock = {
      findFacilityById: jest.fn().mockResolvedValue(mockFacility),
      findFacilityByUserId: jest.fn().mockResolvedValue(mockFacility),
      findConflictingStaffingContract: jest.fn().mockResolvedValue(null),
      createStaffingContract: jest.fn().mockResolvedValue(mockStaffingContract),
      findStaffingContract: jest.fn().mockResolvedValue(mockStaffingContract),
      updateStaffingContractStatus: jest.fn().mockResolvedValue({
        ...mockStaffingContract,
        status: 'ACTIVE' as const,
        signedPdfUrl: 'https://cdn.famidoc.vn/contracts/staffing/signed.pdf',
      }),
      listStaffingContracts: jest.fn().mockResolvedValue({
        items: [mockStaffingContract],
        total: 1,
      }),
      recordStaffingAudit: jest.fn().mockResolvedValue(undefined),
      findAdminUsers: jest.fn().mockResolvedValue([{ id: 'admin-uuid-1' }]),
      createNotification: jest.fn().mockResolvedValue(undefined),
    };

    repositoryMock = {
      transaction: jest.fn().mockImplementation((cb) => cb(sessionMock)),
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

  describe('createStaffingContract (STT 13 - UC-15)', () => {
    const validDto = {
      facilityId: 'fac-uuid-1',
      platformCommissionRate: 15.0,
      facilityRevenueRate: 85.0,
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      signedPdfUrl: 'https://cdn.famidoc.vn/draft.pdf',
    };

    it('should allow ADMIN to create staffing contract for an active facility', async () => {
      const result = await service.createStaffingContract(
        adminUser,
        validDto,
        '127.0.0.1',
      );

      expect(result).toBeDefined();
      expect(result.contractCode).toMatch(/^STF-/);
      expect(result.platformCommissionRate).toBe(15);
      expect(result.facilityRevenueRate).toBe(85);
      expect(result.status).toBe('PENDING_SIGNATURE');
      expect(sessionMock.findFacilityById).toHaveBeenCalledWith('fac-uuid-1');
      expect(sessionMock.createStaffingContract).toHaveBeenCalledWith(
        expect.objectContaining({
          facilityId: 'fac-uuid-1',
          status: 'PENDING_SIGNATURE',
        }),
      );
      expect(sessionMock.recordStaffingAudit).toHaveBeenCalledWith(
        adminUser.id,
        'STAFFING_CONTRACT_CREATED',
        mockStaffingContract.id,
        '127.0.0.1',
      );
    });

    it('should allow HEALTHCARE_FACILITY to create staffing contract using its own facility', async () => {
      const { facilityId: _, ...facilityDto } = validDto;

      const result = await service.createStaffingContract(
        facilityUser,
        facilityDto,
        '127.0.0.1',
      );

      expect(result).toBeDefined();
      expect(sessionMock.findFacilityByUserId).toHaveBeenCalledWith(
        facilityUser.id,
      );
      expect(sessionMock.createStaffingContract).toHaveBeenCalledWith(
        expect.objectContaining({
          facilityId: mockFacility.id,
        }),
      );
    });

    it('should throw ForbiddenException if actor is not ADMIN or HEALTHCARE_FACILITY', async () => {
      await expect(
        service.createStaffingContract(doctorUser, validDto, '127.0.0.1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw BadRequestException if rates do not total 100%', async () => {
      const invalidRatesDto = {
        ...validDto,
        platformCommissionRate: 20.0,
        facilityRevenueRate: 70.0, // Total = 90%
      };

      await expect(
        service.createStaffingContract(adminUser, invalidRatesDto, '127.0.0.1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if endDate is before or equal to startDate', async () => {
      const invalidDatesDto = {
        ...validDto,
        startDate: '2026-12-31',
        endDate: '2026-01-01',
      };

      await expect(
        service.createStaffingContract(adminUser, invalidDatesDto, '127.0.0.1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw ConflictException if conflicting active staffing contract exists', async () => {
      sessionMock.findConflictingStaffingContract!.mockResolvedValue(
        mockStaffingContract as any,
      );

      await expect(
        service.createStaffingContract(adminUser, validDto, '127.0.0.1'),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('signStaffingContract (STT 14 - UC-15)', () => {
    const signDto = {
      signedPdfUrl: 'https://cdn.famidoc.vn/signed.pdf',
      signatureHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    };

    it('should allow ADMIN to sign and activate staffing contract', async () => {
      const result = await service.signStaffingContract(
        adminUser,
        'stf-uuid-1',
        signDto,
        '127.0.0.1',
      );

      expect(result).toBeDefined();
      expect(result.status).toBe('ACTIVE');
      expect(sessionMock.updateStaffingContractStatus).toHaveBeenCalledWith(
        'stf-uuid-1',
        'ACTIVE',
        signDto.signedPdfUrl,
      );
      expect(sessionMock.recordStaffingAudit).toHaveBeenCalledWith(
        adminUser.id,
        'STAFFING_CONTRACT_SIGNED',
        'stf-uuid-1',
        '127.0.0.1',
      );
    });

    it('should allow facility owner to sign and activate staffing contract', async () => {
      const result = await service.signStaffingContract(
        facilityUser,
        'stf-uuid-1',
        signDto,
        '127.0.0.1',
      );

      expect(result.status).toBe('ACTIVE');
      expect(sessionMock.updateStaffingContractStatus).toHaveBeenCalled();
    });

    it('should throw ForbiddenException if facility user signs another facility contract', async () => {
      const anotherFacilityUser: AuthenticatedUser = {
        id: 'another-facility-user',
        role: 'HEALTHCARE_FACILITY',
        familyUnitId: null,
      };

      await expect(
        service.signStaffingContract(
          anotherFacilityUser,
          'stf-uuid-1',
          signDto,
          '127.0.0.1',
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException if contract does not exist', async () => {
      sessionMock.findStaffingContract!.mockResolvedValue(null);

      await expect(
        service.signStaffingContract(
          adminUser,
          'non-existing-id',
          signDto,
          '127.0.0.1',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ConflictException if contract is not PENDING_SIGNATURE', async () => {
      sessionMock.findStaffingContract!.mockResolvedValue({
        ...mockStaffingContract,
        status: 'ACTIVE' as const,
      } as any);

      await expect(
        service.signStaffingContract(
          adminUser,
          'stf-uuid-1',
          signDto,
          '127.0.0.1',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw BadRequestException if contract has already expired', async () => {
      sessionMock.findStaffingContract!.mockResolvedValue({
        ...mockStaffingContract,
        status: 'PENDING_SIGNATURE' as const,
        endDate: new Date('2020-01-01'),
      } as any);

      await expect(
        service.signStaffingContract(
          adminUser,
          'stf-uuid-1',
          signDto,
          '127.0.0.1',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('rejectStaffingContract', () => {
    const rejectDto = {
      rejectionReason: 'Đề xuất giảm tỷ lệ hoa hồng nền tảng xuống 10% và lùi ngày bắt đầu sang tháng sau.',
    };

    it('should allow facility owner to reject staffing contract draft and notify admins', async () => {
      sessionMock.updateStaffingContractStatus!.mockResolvedValueOnce({
        ...mockStaffingContract,
        status: 'TERMINATED' as const,
      } as any);

      const result = await service.rejectStaffingContract(
        facilityUser,
        'stf-uuid-1',
        rejectDto,
        '127.0.0.1',
      );

      expect(result).toBeDefined();
      expect(result.status).toBe('TERMINATED');
      expect(sessionMock.updateStaffingContractStatus).toHaveBeenCalledWith(
        'stf-uuid-1',
        'TERMINATED',
      );
      expect(sessionMock.recordStaffingAudit).toHaveBeenCalledWith(
        facilityUser.id,
        'STAFFING_CONTRACT_REJECTED',
        'stf-uuid-1',
        '127.0.0.1',
      );
      expect(sessionMock.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'admin-uuid-1',
          type: 'STAFFING_CONTRACT_REJECTED',
        }),
      );
    });

    it('should allow ADMIN to cancel/reject staffing contract draft and notify facility', async () => {
      sessionMock.updateStaffingContractStatus!.mockResolvedValueOnce({
        ...mockStaffingContract,
        status: 'TERMINATED' as const,
      } as any);

      const result = await service.rejectStaffingContract(
        adminUser,
        'stf-uuid-1',
        rejectDto,
        '127.0.0.1',
      );

      expect(result).toBeDefined();
      expect(result.status).toBe('TERMINATED');
      expect(sessionMock.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: mockFacility.userId,
          type: 'STAFFING_CONTRACT_CANCELLED',
        }),
      );
    });

    it('should throw ForbiddenException if facility user rejects another facility contract', async () => {
      const anotherFacilityUser: AuthenticatedUser = {
        id: 'another-facility-user',
        role: 'HEALTHCARE_FACILITY',
        familyUnitId: null,
      };

      await expect(
        service.rejectStaffingContract(
          anotherFacilityUser,
          'stf-uuid-1',
          rejectDto,
          '127.0.0.1',
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException if unauthorized role (e.g. DOCTOR) attempts to reject', async () => {
      await expect(
        service.rejectStaffingContract(
          doctorUser,
          'stf-uuid-1',
          rejectDto,
          '127.0.0.1',
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException if contract does not exist', async () => {
      sessionMock.findStaffingContract!.mockResolvedValueOnce(null);

      await expect(
        service.rejectStaffingContract(
          adminUser,
          'non-existing-id',
          rejectDto,
          '127.0.0.1',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ConflictException if contract is not in PENDING_SIGNATURE status', async () => {
      sessionMock.findStaffingContract!.mockResolvedValueOnce({
        ...mockStaffingContract,
        status: 'ACTIVE' as const,
      } as any);

      await expect(
        service.rejectStaffingContract(
          facilityUser,
          'stf-uuid-1',
          rejectDto,
          '127.0.0.1',
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('listStaffingContracts & getStaffingContract', () => {
    it('should list staffing contracts for ADMIN', async () => {
      const result = await service.listStaffingContracts(adminUser, {
        page: 1,
        limit: 10,
      });

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(sessionMock.listStaffingContracts).toHaveBeenCalled();
    });

    it('should get single staffing contract detail for authorized user', async () => {
      const result = await service.getStaffingContract(adminUser, 'stf-uuid-1');

      expect(result).toBeDefined();
      expect(result.id).toBe('stf-uuid-1');
      expect(sessionMock.findStaffingContract).toHaveBeenCalledWith(
        'stf-uuid-1',
      );
    });
  });
});
