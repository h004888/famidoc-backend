import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ContractsServiceImpl } from '../services/impl/contracts.service.impl';
import { ContractsController } from '../controllers/contracts.controller';
import { ContractDocumentRendererService } from '../services/contract-document-renderer.service';
import {
  CONTRACTS_REPOSITORY_TOKEN,
  type IContractsRepository,
} from '../repositories/interfaces/contracts.repository.interface';
import { CONTRACTS_SERVICE_TOKEN } from '../services/interfaces/contracts.service.interface';
import type { AuthenticatedUser } from '../../../core/auth/authenticated-request';
import { JwtAuthGuard } from '../../../core/auth/jwt-auth.guard';
import { RolesGuard } from '../../../core/auth/roles.guard';

describe('Care Needs Summary & Document API (Task 6)', () => {
  let service: ContractsServiceImpl;
  let controller: ContractsController;
  let rendererService: ContractDocumentRendererService;
  let sessionMock: any;
  let repositoryMock: Partial<IContractsRepository>;

  const assignedDoctorUser: AuthenticatedUser = {
    id: 'doctor-user-1',
    role: 'DOCTOR',
    familyUnitId: null,
  };

  const unassignedDoctorUser: AuthenticatedUser = {
    id: 'doctor-user-other',
    role: 'DOCTOR',
    familyUnitId: null,
  };

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

  const facilityUser: AuthenticatedUser = {
    id: 'facility-user-1',
    role: 'HEALTHCARE_FACILITY',
    familyUnitId: null,
  };

  const adminUser: AuthenticatedUser = {
    id: 'admin-uuid-1',
    role: 'ADMIN',
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
    specialty: 'Bác sĩ Gia đình',
    onboardingStatus: 'ACTIVE',
    user: { id: 'doctor-user-1' },
  };

  const mockPackage = {
    id: 'pkg-1',
    packageName: 'Gói Chăm Sóc Toàn Diện',
    durationMonths: 12,
    basePrice: '12000000',
  };

  const mockPatientsWithProfile = [
    {
      id: 'patient-child',
      familyId: 'fam-uuid-1',
      fullName: 'Nguyễn Văn Con',
      dateOfBirth: new Date('2020-01-15'), // ~6 years old -> CHILD
      gender: 'MALE',
      relationshipToHead: 'CON',
      allergies: [
        {
          id: 'allergy-1',
          patientId: 'patient-child',
          allergenType: 'MEDICATION',
          allergenName: 'Amoxicillin',
          severity: 'HIGH',
          clinicalManifestation: 'Phát ban đỏ toàn thân, khó thở nhẹ',
        },
      ],
      documents: [
        {
          id: 'doc-1',
          patientId: 'patient-child',
          documentName: 'Sổ tiêm chủng mở rộng',
          documentType: 'IMMUNIZATION_RECORD',
          fileUrl: 'https://cdn.famidoc.vn/docs/tiemchung-001.pdf',
          fileSizeKb: 1200,
          recordedDate: new Date('2025-06-01'),
        },
      ],
    },
    {
      id: 'patient-adult',
      familyId: 'fam-uuid-1',
      fullName: 'Trần Thị Mẹ',
      dateOfBirth: new Date('1988-10-10'), // ~38 years old -> ADULT
      gender: 'FEMALE',
      relationshipToHead: 'VO',
      allergies: [],
      documents: [],
    },
  ];

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
    contractStatus: 'ACTIVE',
    memberCount: 2,
    billingSnapshot: {
      packageName: 'Gói Chăm Sóc Toàn Diện',
      totalAmount: 12000000,
      basePrice: 12000000,
      includedMembers: 4,
    },
    familyUnit: mockFamily,
    facility: mockFacility,
    doctor: mockDoctor,
    servicePackage: mockPackage,
    members: [
      {
        id: 'member-1',
        contractId: 'contract-uuid-1',
        patientId: 'patient-child',
        patient: mockPatientsWithProfile[0],
      },
      {
        id: 'member-2',
        contractId: 'contract-uuid-1',
        patientId: 'patient-adult',
        patient: mockPatientsWithProfile[1],
      },
    ],
    signatures: [
      {
        id: 'sig-1',
        contractId: 'contract-uuid-1',
        signerRole: 'FAMILY_REP',
        signerUserId: 'user-rep-1',
        termsHash: '6fbc551699981880092f65a12ef6e91cb32616238356bcfb01a1d9571e164478',
        signatureHash: 'sig-hash-family-1234567890abcdef',
        signedAt: new Date('2026-01-01T08:30:00Z'),
        ipAddress: '192.168.1.10',
      },
      {
        id: 'sig-2',
        contractId: 'contract-uuid-1',
        signerRole: 'ADMIN',
        signerUserId: 'admin-uuid-1',
        termsHash: '6fbc551699981880092f65a12ef6e91cb32616238356bcfb01a1d9571e164478',
        signatureHash: 'sig-hash-admin-1234567890abcdef',
        signedAt: new Date('2026-01-01T09:00:00Z'),
        ipAddress: '10.0.0.1',
      },
      {
        id: 'sig-3',
        contractId: 'contract-uuid-1',
        signerRole: 'HEALTHCARE_FACILITY',
        signerUserId: 'facility-user-1',
        termsHash: '6fbc551699981880092f65a12ef6e91cb32616238356bcfb01a1d9571e164478',
        signatureHash: 'sig-hash-facility-1234567890abcdef',
        signedAt: new Date('2026-01-01T10:15:00Z'),
        ipAddress: '118.69.1.50',
      },
      {
        id: 'sig-4',
        contractId: 'contract-uuid-1',
        signerRole: 'ASSIGNED_DOCTOR',
        signerUserId: 'doctor-user-1',
        termsHash: '6fbc551699981880092f65a12ef6e91cb32616238356bcfb01a1d9571e164478',
        signatureHash: 'sig-hash-doctor-1234567890abcdef',
        signedAt: new Date('2026-01-01T11:45:00Z'),
        ipAddress: '118.69.1.80',
      },
    ],
    invoices: [],
  };

  beforeEach(async () => {
    rendererService = new ContractDocumentRendererService();

    sessionMock = {
      findMedicalContractById: jest.fn().mockImplementation((id: string) => {
        if (id === 'contract-uuid-1') return Promise.resolve(mockContractDetail);
        return Promise.resolve(null);
      }),
      findPatientsWithClinicalProfile: jest
        .fn()
        .mockResolvedValue(mockPatientsWithProfile),
      findContractSignatures: jest
        .fn()
        .mockResolvedValue(mockContractDetail.signatures),
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
        {
          provide: ContractDocumentRendererService,
          useValue: rendererService,
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

  describe('getCareNeedsSummary', () => {
    it('assigned doctor retrieves care summary with allergies and medical documents', async () => {
      const summary = await service.getCareNeedsSummary(
        assignedDoctorUser,
        'contract-uuid-1',
      );

      expect(summary).toBeDefined();
      expect(summary.contractId).toBe('contract-uuid-1');
      expect(summary.contractNumber).toBe('CTR-2026-000001');
      expect(summary.members).toHaveLength(2);

      const child = summary.members.find((m: any) => m.patientId === 'patient-child');
      expect(child).toBeDefined();
      expect(child.fullName).toBe('Nguyễn Văn Con');
      expect(child.ageGroup).toBe('CHILD');
      expect(child.allergies).toHaveLength(1);
      expect(child.allergies[0].allergenName).toBe('Amoxicillin');
      expect(child.documents).toHaveLength(1);
      expect(child.documents[0].documentName).toBe('Sổ tiêm chủng mở rộng');

      const adult = summary.members.find((m: any) => m.patientId === 'patient-adult');
      expect(adult).toBeDefined();
      expect(adult.ageGroup).toBe('ADULT');
    });

    it('admin can also view the care needs summary', async () => {
      const summary = await service.getCareNeedsSummary(
        adminUser,
        'contract-uuid-1',
      );
      expect(summary.contractId).toBe('contract-uuid-1');
      expect(summary.members).toHaveLength(2);
    });

    it('throws ForbiddenException if unassigned doctor attempts to access care summary', async () => {
      await expect(
        service.getCareNeedsSummary(unassignedDoctorUser, 'contract-uuid-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException if non-party attempts to access care summary', async () => {
      await expect(
        service.getCareNeedsSummary(otherFamilyRepUser, 'contract-uuid-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException if contract does not exist', async () => {
      await expect(
        service.getCareNeedsSummary(adminUser, 'non-existent-id'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getContractDocument & ContractDocumentRendererService', () => {
    it('renders contract document with HTML view, termsHash, and 4 signatures', async () => {
      const doc = await service.getContractDocument(
        assignedDoctorUser,
        'contract-uuid-1',
      );

      expect(doc).toBeDefined();
      expect(doc.contractId).toBe('contract-uuid-1');
      expect(doc.contractNumber).toBe('CTR-2026-000001');
      expect(doc.termsHash).toBeDefined();
      expect(doc.signatures).toHaveLength(4);
      expect(doc.renderedHtml).toBeDefined();

      // Check rendered HTML contents
      expect(doc.renderedHtml).toContain('CTR-2026-000001');
      expect(doc.renderedHtml).toContain('Bệnh viện Đa khoa Quốc tế');
      expect(doc.renderedHtml).toContain('BS. Nguyễn Văn An');
      expect(doc.renderedHtml).toContain('Nguyễn Văn Con');
      expect(doc.renderedHtml).toContain('FAMILY_REP');
      expect(doc.renderedHtml).toContain('ADMIN');
      expect(doc.renderedHtml).toContain('HEALTHCARE_FACILITY');
      expect(doc.renderedHtml).toContain('ASSIGNED_DOCTOR');
    });

    it('accessible by family representative of the contract', async () => {
      const doc = await service.getContractDocument(
        familyRepUser,
        'contract-uuid-1',
      );
      expect(doc.contractId).toBe('contract-uuid-1');
    });

    it('accessible by healthcare facility of the contract', async () => {
      const doc = await service.getContractDocument(
        facilityUser,
        'contract-uuid-1',
      );
      expect(doc.contractId).toBe('contract-uuid-1');
    });

    it('throws ForbiddenException if non-party attempts to get contract document', async () => {
      await expect(
        service.getContractDocument(otherFamilyRepUser, 'contract-uuid-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('renderer service generates valid formatted HTML with shortened SHA-256 and Vietnam timezone (+07:00)', () => {
      const html = rendererService.renderHtml(
        mockContractDetail,
        mockContractDetail.signatures,
      );

      expect(html).toContain('HỢP ĐỒNG DỊCH VỤ CHĂM SÓC SỨC KHỎE');
      expect(html).toContain('CTR-2026-000001');
      expect(html).toContain('BẢNG CHỮ KÝ ĐIỆN TỬ 4 BÊN');
      // Format verification: GMT+7 or Vietnamese timezone representation
      expect(html).toMatch(/\+07:00|ICT|GMT\+7/);
    });
  });

  describe('ContractsController HTTP Endpoints for Task 6', () => {
    it('GET /api/v1/contracts/medical/:id/care-summary calls service.getCareNeedsSummary', async () => {
      const req: any = { user: assignedDoctorUser };
      const res = await controller.getCareNeedsSummary(req, 'contract-uuid-1');
      expect(res).toBeDefined();
      expect(res.contractId).toBe('contract-uuid-1');
    });

    it('GET /api/v1/contracts/medical/:id/document calls service.getContractDocument', async () => {
      const req: any = { user: assignedDoctorUser };
      const res = await controller.getContractDocument(req, 'contract-uuid-1');
      expect(res).toBeDefined();
      expect(res.contractNumber).toBe('CTR-2026-000001');
    });
  });
});
