import { Test, TestingModule } from '@nestjs/testing';
import { PatientsController } from '../controllers/patients.controller';
import {
  PATIENTS_SERVICE_TOKEN,
  type IPatientsService,
} from '../services/interfaces/patients.service.interface';
import { JwtAuthGuard } from '../../../core/auth/jwt-auth.guard';
import { RolesGuard } from '../../../core/auth/roles.guard';
import type { AuthenticatedRequest } from '../../../core/auth/authenticated-request';
import { Gender, AllergenType, AllergySeverity, PatientDocumentType } from '@prisma/client';
import type { CreatePatientDto } from '../dtos/create-patient.dto';
import type { UpdatePatientDto } from '../dtos/update-patient.dto';
import type { CreateAllergyDto } from '../dtos/create-allergy.dto';
import type { CreatePatientDocumentDto } from '../dtos/create-patient-document.dto';

describe('PatientsController', () => {
  let controller: PatientsController;
  let service: jest.Mocked<IPatientsService>;

  const mockFamilyRepReq = {
    user: {
      id: 'user-rep-uuid-1',
      role: 'FAMILY_REP',
      familyUnitId: 'family-uuid-1',
    },
  } as unknown as AuthenticatedRequest;

  const mockPatient = {
    id: 'patient-uuid-1',
    familyId: 'family-uuid-1',
    fullName: 'Nguyễn Văn Con',
    dateOfBirth: new Date('2015-05-20'),
    gender: Gender.MALE,
    relationshipToHead: 'CON',
    citizenId: '001201500001',
    healthInsuranceNumber: 'DN4010123456789',
    status: 'ACTIVE' as const,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockAllergy = {
    id: 'allergy-uuid-1',
    patientId: 'patient-uuid-1',
    allergenType: AllergenType.DRUG,
    allergenName: 'Paracetamol',
    severity: AllergySeverity.MODERATE,
    clinicalManifestation: 'Phát ban',
    createdAt: new Date(),
  };

  const mockDocument = {
    id: 'doc-uuid-1',
    patientId: 'patient-uuid-1',
    documentName: 'Xét nghiệm máu',
    documentType: PatientDocumentType.LAB_RESULT,
    fileUrl: 'https://storage.famidoc.vn/docs/blood_test.pdf',
    fileSizeKb: 1024,
    recordedDate: new Date('2026-11-01'),
    uploadedAt: new Date(),
  };

  beforeEach(async () => {
    service = {
      createPatient: jest.fn(),
      listFamilyMembers: jest.fn(),
      getPatientById: jest.fn(),
      updatePatient: jest.fn(),
      addAllergy: jest.fn(),
      listAllergies: jest.fn(),
      addDocument: jest.fn(),
      listDocuments: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PatientsController],
      providers: [
        {
          provide: PATIENTS_SERVICE_TOKEN,
          useValue: service,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<PatientsController>(PatientsController);
  });

  it('should have path api/v1/patients and roles FAMILY_REP and ADMIN', () => {
    const path = Reflect.getMetadata('path', PatientsController);
    expect(path).toBe('api/v1/patients');

    const roles = Reflect.getMetadata('allowedRoles', PatientsController);
    expect(roles).toEqual(expect.arrayContaining(['FAMILY_REP', 'ADMIN']));
  });

  describe('POST /api/v1/patients', () => {
    it('thêm hồ sơ bệnh nhân thành công', async () => {
      const dto: CreatePatientDto = {
        fullName: 'Nguyễn Văn Con',
        dateOfBirth: '2015-05-20',
        gender: Gender.MALE,
        relationshipToRepresentative: 'CON',
        identityNumber: '001201500001',
      };
      service.createPatient.mockResolvedValue(mockPatient);

      const result = await controller.createPatient(mockFamilyRepReq, dto);

      expect(service.createPatient).toHaveBeenCalledWith(mockFamilyRepReq.user, dto);
      expect(result).toEqual(mockPatient);
    });
  });

  describe('GET /api/v1/patients', () => {
    it('lấy danh sách thành viên trong hộ thành công', async () => {
      service.listFamilyMembers.mockResolvedValue([mockPatient]);

      const result = await controller.listFamilyMembers(mockFamilyRepReq);

      expect(service.listFamilyMembers).toHaveBeenCalledWith(mockFamilyRepReq.user);
      expect(result).toEqual([mockPatient]);
    });
  });

  describe('GET /api/v1/patients/:id', () => {
    it('lấy chi tiết bệnh nhân thành công', async () => {
      service.getPatientById.mockResolvedValue(mockPatient);

      const result = await controller.getPatientById(mockFamilyRepReq, 'patient-uuid-1');

      expect(service.getPatientById).toHaveBeenCalledWith(mockFamilyRepReq.user, 'patient-uuid-1');
      expect(result).toEqual(mockPatient);
    });
  });

  describe('PUT /api/v1/patients/:id', () => {
    it('cập nhật thông tin bệnh nhân thành công', async () => {
      const dto: UpdatePatientDto = { fullName: 'Nguyễn Văn Con Mới' };
      const updated = { ...mockPatient, fullName: 'Nguyễn Văn Con Mới' };
      service.updatePatient.mockResolvedValue(updated);

      const result = await controller.updatePatient(mockFamilyRepReq, 'patient-uuid-1', dto);

      expect(service.updatePatient).toHaveBeenCalledWith(mockFamilyRepReq.user, 'patient-uuid-1', dto);
      expect(result).toEqual(updated);
    });
  });

  describe('POST /api/v1/patients/:id/allergies', () => {
    it('khai báo dị ứng thành công', async () => {
      const dto: CreateAllergyDto = {
        allergenType: AllergenType.DRUG,
        allergenName: 'Paracetamol',
        severity: AllergySeverity.MODERATE,
        clinicalManifestation: 'Phát ban',
      };
      service.addAllergy.mockResolvedValue(mockAllergy);

      const result = await controller.addAllergy(mockFamilyRepReq, 'patient-uuid-1', dto);

      expect(service.addAllergy).toHaveBeenCalledWith(mockFamilyRepReq.user, 'patient-uuid-1', dto);
      expect(result).toEqual(mockAllergy);
    });
  });

  describe('GET /api/v1/patients/:id/allergies', () => {
    it('xem danh sách dị ứng thành công', async () => {
      service.listAllergies.mockResolvedValue([mockAllergy]);

      const result = await controller.listAllergies(mockFamilyRepReq, 'patient-uuid-1');

      expect(service.listAllergies).toHaveBeenCalledWith(mockFamilyRepReq.user, 'patient-uuid-1');
      expect(result).toEqual([mockAllergy]);
    });
  });

  describe('POST /api/v1/patients/:id/documents', () => {
    it('đính kèm hồ sơ y tế thành công', async () => {
      const dto: CreatePatientDocumentDto = {
        documentName: 'Xét nghiệm máu',
        documentType: PatientDocumentType.LAB_RESULT,
        fileUrl: 'https://storage.famidoc.vn/docs/blood_test.pdf',
        fileSizeKb: 1024,
        recordedDate: '2026-11-01',
      };
      service.addDocument.mockResolvedValue(mockDocument);

      const result = await controller.addDocument(mockFamilyRepReq, 'patient-uuid-1', dto);

      expect(service.addDocument).toHaveBeenCalledWith(mockFamilyRepReq.user, 'patient-uuid-1', dto);
      expect(result).toEqual(mockDocument);
    });
  });

  describe('GET /api/v1/patients/:id/documents', () => {
    it('xem danh sách hồ sơ y tế thành công', async () => {
      service.listDocuments.mockResolvedValue([mockDocument]);

      const result = await controller.listDocuments(mockFamilyRepReq, 'patient-uuid-1');

      expect(service.listDocuments).toHaveBeenCalledWith(mockFamilyRepReq.user, 'patient-uuid-1');
      expect(result).toEqual([mockDocument]);
    });
  });
});
