import { ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { PatientsServiceImpl } from '../services/impl/patients.service.impl';
import type { IPatientsRepository } from '../repositories/interfaces/patients.repository.interface';
import { Gender, AllergenType, AllergySeverity, PatientDocumentType } from '@prisma/client';
import type { AuthenticatedUser } from '../../../core/auth/authenticated-request';
import type { CreatePatientDto } from '../dtos/create-patient.dto';
import type { UpdatePatientDto } from '../dtos/update-patient.dto';
import type { CreateAllergyDto } from '../dtos/create-allergy.dto';
import type { CreatePatientDocumentDto } from '../dtos/create-patient-document.dto';

describe('PatientsServiceImpl', () => {
  let service: PatientsServiceImpl;
  let repository: jest.Mocked<IPatientsRepository>;

  const mockFamilyRep: AuthenticatedUser = {
    id: 'user-rep-uuid-1',
    role: 'FAMILY_REP',
    familyUnitId: 'family-uuid-1',
  };

  const mockAdmin: AuthenticatedUser = {
    id: 'user-admin-uuid-1',
    role: 'ADMIN',
    familyUnitId: null,
  };

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

  const mockOtherFamilyPatient = {
    id: 'patient-uuid-2',
    familyId: 'family-uuid-999',
    fullName: 'Người Lạ',
    dateOfBirth: new Date('1990-01-01'),
    gender: Gender.FEMALE,
    relationshipToHead: 'SELF',
    citizenId: null,
    healthInsuranceNumber: null,
    status: 'ACTIVE' as const,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    repository = {
      create: jest.fn(),
      findById: jest.fn(),
      findByFamilyId: jest.fn(),
      findAll: jest.fn(),
      update: jest.fn(),
      findFamilyUnitByRepresentativeUserId: jest.fn(),
      findFamilyUnitById: jest.fn(),
      addAllergy: jest.fn(),
      findAllergiesByPatientId: jest.fn(),
      addDocument: jest.fn(),
      findDocumentsByPatientId: jest.fn(),
    };

    service = new PatientsServiceImpl(repository);
  });

  describe('createPatient', () => {
    const dto: CreatePatientDto = {
      fullName: 'Nguyễn Văn Con',
      dateOfBirth: '2015-05-20',
      gender: Gender.MALE,
      relationshipToRepresentative: 'CON',
      identityNumber: '001201500001',
      phoneNumber: '0987654321',
      bloodType: 'O+',
      healthInsuranceNumber: 'DN4010123456789',
    };

    it('FAMILY_REP thêm thành viên mới vào hộ gia đình của mình thành công', async () => {
      repository.create.mockResolvedValue(mockPatient);

      const result = await service.createPatient(mockFamilyRep, dto);

      expect(repository.create).toHaveBeenCalledWith('family-uuid-1', dto);
      expect(result).toEqual(mockPatient);
    });

    it('FAMILY_REP chưa có familyUnitId trong JWT token thì truy vấn DB theo representativeUserId', async () => {
      const repWithoutFamilyId: AuthenticatedUser = {
        id: 'user-rep-uuid-1',
        role: 'FAMILY_REP',
        familyUnitId: null,
      };

      repository.findFamilyUnitByRepresentativeUserId.mockResolvedValue({
        id: 'family-uuid-db',
        representativeUserId: 'user-rep-uuid-1',
        homeAddress: 'Hà Nội',
        emergencyPhone: '0912345678',
        status: 'ACTIVE',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      repository.create.mockResolvedValue({ ...mockPatient, familyId: 'family-uuid-db' });

      const result = await service.createPatient(repWithoutFamilyId, dto);

      expect(repository.findFamilyUnitByRepresentativeUserId).toHaveBeenCalledWith('user-rep-uuid-1');
      expect(repository.create).toHaveBeenCalledWith('family-uuid-db', dto);
      expect(result.familyId).toBe('family-uuid-db');
    });

    it('FAMILY_REP không tìm thấy FamilyUnit sẽ ném ForbiddenException', async () => {
      const repWithoutFamilyId: AuthenticatedUser = {
        id: 'user-rep-uuid-1',
        role: 'FAMILY_REP',
        familyUnitId: null,
      };

      repository.findFamilyUnitByRepresentativeUserId.mockResolvedValue(null);

      await expect(service.createPatient(repWithoutFamilyId, dto)).rejects.toThrow(ForbiddenException);
    });

    it('ADMIN tạo bệnh nhân bắt buộc phải truyền familyId trong DTO', async () => {
      await expect(service.createPatient(mockAdmin, dto)).rejects.toThrow(BadRequestException);

      const adminDto: CreatePatientDto = { ...dto, familyId: 'family-uuid-target' };
      repository.create.mockResolvedValue({ ...mockPatient, familyId: 'family-uuid-target' });

      const result = await service.createPatient(mockAdmin, adminDto);
      expect(repository.create).toHaveBeenCalledWith('family-uuid-target', adminDto);
      expect(result.familyId).toBe('family-uuid-target');
    });
  });

  describe('listFamilyMembers', () => {
    it('FAMILY_REP chỉ lấy danh sách bệnh nhân thuộc familyUnitId của mình', async () => {
      repository.findByFamilyId.mockResolvedValue([mockPatient]);

      const result = await service.listFamilyMembers(mockFamilyRep);

      expect(repository.findByFamilyId).toHaveBeenCalledWith('family-uuid-1');
      expect(result).toEqual([mockPatient]);
    });

    it('ADMIN lấy toàn bộ danh sách bệnh nhân', async () => {
      repository.findAll.mockResolvedValue([mockPatient, mockOtherFamilyPatient]);

      const result = await service.listFamilyMembers(mockAdmin);

      expect(repository.findAll).toHaveBeenCalled();
      expect(result).toHaveLength(2);
    });
  });

  describe('getPatientById', () => {
    it('FAMILY_REP lấy chi tiết bệnh nhân thuộc hộ gia đình mình thành công', async () => {
      repository.findById.mockResolvedValue(mockPatient);

      const result = await service.getPatientById(mockFamilyRep, 'patient-uuid-1');

      expect(repository.findById).toHaveBeenCalledWith('patient-uuid-1');
      expect(result).toEqual(mockPatient);
    });

    it('FAMILY_REP truy cập bệnh nhân không thuộc hộ gia đình mình bị ném ForbiddenException', async () => {
      repository.findById.mockResolvedValue(mockOtherFamilyPatient);

      await expect(service.getPatientById(mockFamilyRep, 'patient-uuid-2')).rejects.toThrow(ForbiddenException);
    });

    it('truy vấn bệnh nhân không tồn tại bị ném NotFoundException', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.getPatientById(mockFamilyRep, 'non-existent')).rejects.toThrow(NotFoundException);
    });

    it('ADMIN có quyền xem bất kỳ hồ sơ bệnh nhân nào', async () => {
      repository.findById.mockResolvedValue(mockOtherFamilyPatient);

      const result = await service.getPatientById(mockAdmin, 'patient-uuid-2');
      expect(result).toEqual(mockOtherFamilyPatient);
    });
  });

  describe('updatePatient', () => {
    const updateDto: UpdatePatientDto = {
      fullName: 'Nguyễn Văn Con Mới',
    };

    it('FAMILY_REP cập nhật bệnh nhân thuộc hộ của mình thành công', async () => {
      repository.findById.mockResolvedValue(mockPatient);
      const updated = { ...mockPatient, fullName: 'Nguyễn Văn Con Mới' };
      repository.update.mockResolvedValue(updated);

      const result = await service.updatePatient(mockFamilyRep, 'patient-uuid-1', updateDto);

      expect(repository.update).toHaveBeenCalledWith('patient-uuid-1', updateDto);
      expect(result.fullName).toBe('Nguyễn Văn Con Mới');
    });

    it('FAMILY_REP sửa bệnh nhân khác hộ bị ném ForbiddenException', async () => {
      repository.findById.mockResolvedValue(mockOtherFamilyPatient);

      await expect(service.updatePatient(mockFamilyRep, 'patient-uuid-2', updateDto)).rejects.toThrow(ForbiddenException);
    });

    it('ADMIN có thể cập nhật bất kỳ bệnh nhân nào', async () => {
      repository.findById.mockResolvedValue(mockOtherFamilyPatient);
      const updated = { ...mockOtherFamilyPatient, fullName: 'Đã Cập Nhật' };
      repository.update.mockResolvedValue(updated);

      const result = await service.updatePatient(mockAdmin, 'patient-uuid-2', updateDto);
      expect(result.fullName).toBe('Đã Cập Nhật');
    });
  });

  describe('addAllergy & listAllergies', () => {
    const allergyDto: CreateAllergyDto = {
      allergenType: AllergenType.DRUG,
      allergenName: 'Paracetamol',
      severity: AllergySeverity.MODERATE,
      clinicalManifestation: 'Phát ban ngứa toàn thân',
    };

    const mockAllergy = {
      id: 'allergy-uuid-1',
      patientId: 'patient-uuid-1',
      allergenType: AllergenType.DRUG,
      allergenName: 'Paracetamol',
      severity: AllergySeverity.MODERATE,
      clinicalManifestation: 'Phát ban ngứa toàn thân',
      createdAt: new Date(),
    };

    it('FAMILY_REP khai báo dị ứng cho thành viên trong hộ thành công', async () => {
      repository.findById.mockResolvedValue(mockPatient);
      repository.addAllergy.mockResolvedValue(mockAllergy);

      const result = await service.addAllergy(mockFamilyRep, 'patient-uuid-1', allergyDto);

      expect(repository.addAllergy).toHaveBeenCalledWith('patient-uuid-1', allergyDto);
      expect(result).toEqual(mockAllergy);
    });

    it('FAMILY_REP khai báo dị ứng cho người ngoài hộ bị ném ForbiddenException', async () => {
      repository.findById.mockResolvedValue(mockOtherFamilyPatient);

      await expect(service.addAllergy(mockFamilyRep, 'patient-uuid-2', allergyDto)).rejects.toThrow(ForbiddenException);
    });

    it('FAMILY_REP xem danh sách dị ứng của bệnh nhân trong hộ thành công', async () => {
      repository.findById.mockResolvedValue(mockPatient);
      repository.findAllergiesByPatientId.mockResolvedValue([mockAllergy]);

      const result = await service.listAllergies(mockFamilyRep, 'patient-uuid-1');

      expect(repository.findAllergiesByPatientId).toHaveBeenCalledWith('patient-uuid-1');
      expect(result).toEqual([mockAllergy]);
    });

    it('FAMILY_REP xem danh sách dị ứng của bệnh nhân ngoài hộ bị ném ForbiddenException', async () => {
      repository.findById.mockResolvedValue(mockOtherFamilyPatient);

      await expect(service.listAllergies(mockFamilyRep, 'patient-uuid-2')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('addDocument & listDocuments', () => {
    const docDto: CreatePatientDocumentDto = {
      documentName: 'Phiếu xét nghiệm máu',
      documentType: PatientDocumentType.LAB_RESULT,
      fileUrl: 'https://storage.famidoc.vn/docs/blood_test.pdf',
      fileSizeKb: 1024,
      recordedDate: '2026-11-01',
    };

    const mockDoc = {
      id: 'doc-uuid-1',
      patientId: 'patient-uuid-1',
      documentName: 'Phiếu xét nghiệm máu',
      documentType: PatientDocumentType.LAB_RESULT,
      fileUrl: 'https://storage.famidoc.vn/docs/blood_test.pdf',
      fileSizeKb: 1024,
      recordedDate: new Date('2026-11-01'),
      uploadedAt: new Date(),
    };

    it('FAMILY_REP đính kèm tài liệu y tế cho thành viên trong hộ thành công', async () => {
      repository.findById.mockResolvedValue(mockPatient);
      repository.addDocument.mockResolvedValue(mockDoc);

      const result = await service.addDocument(mockFamilyRep, 'patient-uuid-1', docDto);

      expect(repository.addDocument).toHaveBeenCalledWith('patient-uuid-1', docDto);
      expect(result).toEqual(mockDoc);
    });

    it('FAMILY_REP đính kèm tài liệu y tế cho người ngoài hộ bị ném ForbiddenException', async () => {
      repository.findById.mockResolvedValue(mockOtherFamilyPatient);

      await expect(service.addDocument(mockFamilyRep, 'patient-uuid-2', docDto)).rejects.toThrow(ForbiddenException);
    });

    it('FAMILY_REP xem danh sách tài liệu y tế thành công', async () => {
      repository.findById.mockResolvedValue(mockPatient);
      repository.findDocumentsByPatientId.mockResolvedValue([mockDoc]);

      const result = await service.listDocuments(mockFamilyRep, 'patient-uuid-1');

      expect(repository.findDocumentsByPatientId).toHaveBeenCalledWith('patient-uuid-1');
      expect(result).toEqual([mockDoc]);
    });

    it('FAMILY_REP xem danh sách tài liệu y tế người ngoài hộ bị ném ForbiddenException', async () => {
      repository.findById.mockResolvedValue(mockOtherFamilyPatient);

      await expect(service.listDocuments(mockFamilyRep, 'patient-uuid-2')).rejects.toThrow(ForbiddenException);
    });
  });
});
