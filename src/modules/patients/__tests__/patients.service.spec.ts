import { ForbiddenException, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PatientsServiceImpl } from '../services/impl/patients.service.impl';
import type { IPatientsRepository } from '../repositories/interfaces/patients.repository.interface';
import { Gender, AllergenType, AllergySeverity, PatientDocumentType } from '@prisma/client';
import type { AuthenticatedUser } from '../../../core/auth/authenticated-request';
import type { CreatePatientDto } from '../dtos/create-patient.dto';
import type { UpdatePatientDto } from '../dtos/update-patient.dto';
import type { CreateAllergyDto } from '../dtos/create-allergy.dto';
import type { CreatePatientDocumentDto } from '../dtos/create-patient-document.dto';
import type { StorageService } from '../../../core/services/storage.service';

describe('PatientsServiceImpl', () => {
  let service: PatientsServiceImpl;
  let repository: jest.Mocked<IPatientsRepository>;
  let storage: {
    uploadFile: jest.Mock;
    downloadFile: jest.Mock;
    deleteFile: jest.Mock;
    objectExists: jest.Mock;
  };

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
    bloodType: 'O+',
    heightCm: null,
    weightKg: null,
    chronicDiseases: null,
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
    bloodType: null,
    heightCm: null,
    weightKg: null,
    chronicDiseases: null,
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
      findDocumentById: jest.fn(),
      deleteDocument: jest.fn(),
    };

    storage = {
      uploadFile: jest.fn(),
      downloadFile: jest.fn(),
      deleteFile: jest.fn(),
      objectExists: jest.fn(),
    };

    service = new PatientsServiceImpl(repository, storage as unknown as StorageService);
  });

  describe('createPatient', () => {
    const dto: CreatePatientDto = {
      fullName: 'Nguyễn Văn Con',
      dateOfBirth: '2015-05-20',
      gender: Gender.MALE,
      relationshipToRepresentative: 'CON',
      bloodType: 'O+',
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

    it('chặn tạo bệnh nhân với HTTP 403 khi hộ gia đình chưa có hợp đồng ACTIVE', async () => {
      repository.findActiveContractByFamilyId = jest.fn().mockResolvedValue(null);
      repository.countPatientsByFamilyId = jest.fn();
      repository.createAndAttachToContract = jest.fn();

      await expect(service.createPatient(mockFamilyRep, dto)).rejects.toThrow(
        ForbiddenException,
      );
      expect(repository.findActiveContractByFamilyId).toHaveBeenCalledWith(
        'family-uuid-1',
      );
      expect(repository.createAndAttachToContract).not.toHaveBeenCalled();
    });

    it('chặn tạo bệnh nhân với HTTP 400 khi đã đạt trần memberCount của hợp đồng ACTIVE', async () => {
      repository.findActiveContractByFamilyId = jest
        .fn()
        .mockResolvedValue({ id: 'contract-active-1', memberCount: 3 });
      repository.countPatientsByFamilyId = jest.fn().mockResolvedValue(3);
      repository.createAndAttachToContract = jest.fn();

      await expect(service.createPatient(mockFamilyRep, dto)).rejects.toThrow(
        BadRequestException,
      );
      expect(repository.countPatientsByFamilyId).toHaveBeenCalledWith(
        'family-uuid-1',
      );
      expect(repository.createAndAttachToContract).not.toHaveBeenCalled();
    });

    it('tạo bệnh nhân thành công và gắn vào ContractMember khi còn suất trong hợp đồng ACTIVE', async () => {
      repository.findActiveContractByFamilyId = jest
        .fn()
        .mockResolvedValue({ id: 'contract-active-1', memberCount: 4 });
      repository.countPatientsByFamilyId = jest.fn().mockResolvedValue(2);
      repository.createAndAttachToContract = jest
        .fn()
        .mockResolvedValue(mockPatient);

      const result = await service.createPatient(mockFamilyRep, dto);

      expect(repository.createAndAttachToContract).toHaveBeenCalledWith(
        'family-uuid-1',
        'contract-active-1',
        dto,
      );
      expect(result).toEqual(mockPatient);
    });

    it('ưu tiên dùng createWithActiveContractLock khi repository cung cấp cơ chế khóa transaction atomic', async () => {
      repository.createWithActiveContractLock = jest
        .fn()
        .mockResolvedValue(mockPatient);

      const result = await service.createPatient(mockFamilyRep, dto);

      expect(repository.createWithActiveContractLock).toHaveBeenCalledWith(
        'family-uuid-1',
        dto,
      );
      expect(repository.create).not.toHaveBeenCalled();
      expect(result).toEqual(mockPatient);
    });

    it('chặn ngày sinh trong tương lai hoặc tuổi vượt quá 120 năm bằng BadRequestException', async () => {
      await expect(
        service.createPatient(mockFamilyRep, { ...dto, dateOfBirth: '2999-01-01' }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.createPatient(mockFamilyRep, { ...dto, dateOfBirth: '1850-01-01' }),
      ).rejects.toThrow(BadRequestException);

      expect(repository.create).not.toHaveBeenCalled();
    });

    it('chặn trùng SELF bằng ConflictException trên fallback path', async () => {
      repository.findActiveDuplicateByFamilyId = jest.fn().mockResolvedValue('SELF');

      await expect(service.createPatient(mockFamilyRep, dto)).rejects.toThrow(ConflictException);
      expect(repository.create).not.toHaveBeenCalled();
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

  describe('detachPatient', () => {
    it('FAMILY_REP tách thành viên không phải chủ hộ chuyển status sang INACTIVE', async () => {
      repository.findById.mockResolvedValue(mockPatient);
      const detached = { ...mockPatient, status: 'INACTIVE' as const };
      repository.softDeactivate = jest.fn().mockResolvedValue(detached);

      const result = await service.detachPatient(mockFamilyRep, 'patient-uuid-1');

      expect(repository.softDeactivate).toHaveBeenCalledWith('patient-uuid-1');
      expect(result.status).toBe('INACTIVE');
    });

    it('chặn tách chủ hộ (SELF) bằng BadRequestException', async () => {
      repository.findById.mockResolvedValue({
        ...mockPatient,
        relationshipToHead: 'SELF',
      });

      await expect(
        service.detachPatient(mockFamilyRep, 'patient-uuid-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('chặn tách thành viên đã ở trạng thái INACTIVE', async () => {
      repository.findById.mockResolvedValue({
        ...mockPatient,
        status: 'INACTIVE' as const,
      });

      await expect(
        service.detachPatient(mockFamilyRep, 'patient-uuid-1'),
      ).rejects.toThrow(BadRequestException);
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

  describe('addDocument, listDocuments, getDocumentFile & deleteDocument', () => {
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
      mimeType: 'application/pdf',
      notes: null,
      fileSizeKb: 1024,
      recordedDate: new Date('2026-11-01'),
      uploadedAt: new Date(),
    };

    it('FAMILY_REP đính kèm tài liệu y tế dạng URL hợp lệ cho thành viên trong hộ thành công', async () => {
      repository.findById.mockResolvedValue(mockPatient);
      repository.addDocument.mockResolvedValue(mockDoc);

      const result = await service.addDocument(mockFamilyRep, 'patient-uuid-1', docDto);

      expect(repository.addDocument).toHaveBeenCalledWith(
        'patient-uuid-1',
        expect.objectContaining({
          documentName: 'Phiếu xét nghiệm máu',
          documentType: PatientDocumentType.LAB_RESULT,
          fileUrl: 'https://storage.famidoc.vn/docs/blood_test.pdf',
          fileSizeKb: 1024,
        }),
      );
      expect(result).toMatchObject({
        ...mockDoc,
        downloadPath: docDto.fileUrl,
        previewUrl: null,
      });
    });

    it('FAMILY_REP upload file PDF đơn thuốc thật lên SeaweedFS S3 thành công', async () => {
      repository.findById.mockResolvedValue(mockPatient);
      storage.uploadFile.mockResolvedValue('patient-documents/patient-uuid-1/173000-1.pdf');
      const createdInternalDoc = {
        ...mockDoc,
        id: 'doc-uuid-presc',
        documentName: 'Đơn thuốc tim mạch T11',
        documentType: PatientDocumentType.PRESCRIPTION,
        fileUrl: 'patient-documents/patient-uuid-1/173000-1.pdf',
        notes: 'BV ĐHYD - BS. Hùng',
        fileSizeKb: 1,
      };
      repository.addDocument.mockResolvedValue(createdInternalDoc);

      const fakePdfFile = {
        originalname: 'don-thuoc.pdf',
        mimetype: 'application/pdf',
        size: 128,
        buffer: Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj'),
      } as Express.Multer.File;

      const result = await service.addDocument(
        mockFamilyRep,
        'patient-uuid-1',
        {
          documentName: 'Đơn thuốc tim mạch T11',
          documentType: PatientDocumentType.PRESCRIPTION,
          recordedDate: '2026-11-18',
          notes: 'BV ĐHYD - BS. Hùng',
        },
        fakePdfFile,
      );

      expect(storage.uploadFile).toHaveBeenCalledWith(
        expect.objectContaining({
          mimetype: 'application/pdf',
        }),
        'patient-documents/patient-uuid-1',
      );
      expect(result.downloadPath).toBe(
        '/api/v1/patients/patient-uuid-1/documents/doc-uuid-presc/file',
      );
    });

    it('từ chối tệp giả mạo định dạng hoặc thiếu cả tệp lẫn URL hợp lệ (400)', async () => {
      repository.findById.mockResolvedValue(mockPatient);

      const spoofedFile = {
        originalname: 'malware.pdf',
        mimetype: 'application/pdf',
        size: 10,
        buffer: Buffer.from('MZ-not-a-pdf'),
      } as Express.Multer.File;

      await expect(
        service.addDocument(
          mockFamilyRep,
          'patient-uuid-1',
          {
            documentName: 'Đơn thuốc',
            documentType: PatientDocumentType.PRESCRIPTION,
            recordedDate: '2026-11-18',
          },
          spoofedFile,
        ),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.addDocument(mockFamilyRep, 'patient-uuid-1', {
          documentName: 'Đơn thuốc',
          documentType: PatientDocumentType.PRESCRIPTION,
          recordedDate: '2026-11-18',
        }),
      ).rejects.toThrow(BadRequestException);
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
      expect(result[0]).toMatchObject({
        ...mockDoc,
        downloadPath: mockDoc.fileUrl,
      });
    });

    it('FAMILY_REP xem danh sách tài liệu y tế người ngoài hộ bị ném ForbiddenException', async () => {
      repository.findById.mockResolvedValue(mockOtherFamilyPatient);

      await expect(service.listDocuments(mockFamilyRep, 'patient-uuid-2')).rejects.toThrow(ForbiddenException);
    });

    it('tải tệp tài liệu nội bộ hợp lệ và chặn truy cập trái quyền (403)', async () => {
      const internalDoc = {
        ...mockDoc,
        id: 'doc-int-1',
        fileUrl: 'patient-documents/patient-uuid-1/test.png',
        mimeType: 'image/png',
      };
      repository.findById.mockResolvedValue(mockPatient);
      (repository.findDocumentById as jest.Mock).mockResolvedValue(internalDoc);
      storage.downloadFile.mockResolvedValue({
        bytes: Buffer.from('png-bytes'),
        contentType: 'image/png',
      });

      const fileRes = await service.getDocumentFile(mockFamilyRep, 'patient-uuid-1', 'doc-int-1');
      expect(fileRes.contentType).toBe('image/png');
      expect(storage.downloadFile).toHaveBeenCalledWith('patient-documents/patient-uuid-1/test.png');

      repository.findById.mockResolvedValueOnce(mockOtherFamilyPatient);
      await expect(
        service.getDocumentFile(mockFamilyRep, 'patient-uuid-2', 'doc-int-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('xóa tài liệu nội bộ khỏi DB và SeaweedFS S3 cho đúng thành viên trong hộ', async () => {
      const internalDoc = {
        ...mockDoc,
        id: 'doc-del-1',
        fileUrl: 'patient-documents/patient-uuid-1/del.pdf',
      };
      repository.findById.mockResolvedValue(mockPatient);
      (repository.findDocumentById as jest.Mock).mockResolvedValue(internalDoc);
      (repository.deleteDocument as jest.Mock).mockResolvedValue(internalDoc);

      const deleted = await service.deleteDocument(mockFamilyRep, 'patient-uuid-1', 'doc-del-1');
      expect(repository.deleteDocument).toHaveBeenCalledWith('doc-del-1');
      expect(storage.deleteFile).toHaveBeenCalledWith('patient-documents/patient-uuid-1/del.pdf');
      expect(deleted.id).toBe('doc-del-1');

      repository.findById.mockResolvedValueOnce(mockOtherFamilyPatient);
      await expect(
        service.deleteDocument(mockFamilyRep, 'patient-uuid-2', 'doc-del-1'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('deleteAllergy', () => {
    it('xóa dị ứng thuộc thành viên trong hộ thành công', async () => {
      const mockAllergy = {
        id: 'allergy-1',
        patientId: 'patient-uuid-1',
        allergenType: AllergenType.DRUG,
        allergenName: 'Penicillin',
        severity: AllergySeverity.MODERATE,
        clinicalManifestation: 'Mẩn đỏ',
        createdAt: new Date(),
      };
      repository.findById.mockResolvedValue(mockPatient);
      repository.findAllergyById = jest.fn().mockResolvedValue(mockAllergy);
      repository.deleteAllergy = jest.fn().mockResolvedValue(mockAllergy);

      const result = await service.deleteAllergy(mockFamilyRep, 'patient-uuid-1', 'allergy-1');

      expect(repository.deleteAllergy).toHaveBeenCalledWith('allergy-1');
      expect(result).toEqual(mockAllergy);
    });

    it('ném NotFoundException nếu dị ứng không thuộc patientId', async () => {
      repository.findById.mockResolvedValue(mockPatient);
      repository.findAllergyById = jest.fn().mockResolvedValue({
        id: 'allergy-2',
        patientId: 'other-patient',
      });

      await expect(
        service.deleteAllergy(mockFamilyRep, 'patient-uuid-1', 'allergy-2'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('vitalSigns CRUD', () => {
    const baseVital = {
      id: 'vit-1',
      emrId: null,
      patientId: 'patient-uuid-1',
      systolicBp: 145,
      diastolicBp: 92,
      heartRate: 78,
      temperature: 36.8 as any,
      spo2: 98,
      respiratoryRate: 18,
      bloodGlucose: 6.2 as any,
      isAbnormalAlert: true,
      recordedAt: new Date('2026-11-18T08:00:00.000Z'),
    };

    it('tạo chỉ số sinh tồn và tự tính isAbnormalAlert + serialize số thực', async () => {
      repository.findById.mockResolvedValue(mockPatient);
      repository.addVitalSign = jest.fn().mockResolvedValue(baseVital);

      const result = await service.addVitalSign(mockFamilyRep, 'patient-uuid-1', {
        systolicBp: 145,
        diastolicBp: 92,
        temperature: 36.8,
        bloodGlucose: 6.2,
      });

      expect(repository.addVitalSign).toHaveBeenCalledWith(
        'patient-uuid-1',
        expect.objectContaining({ systolicBp: 145 }),
        true,
      );
      expect(result.temperature).toBe(36.8);
      expect(result.bloodGlucose).toBe(6.2);
      expect(result.isAbnormalAlert).toBe(true);
    });

    it('lấy danh sách chỉ số sinh tồn với tham số days hợp lệ', async () => {
      repository.findById.mockResolvedValue(mockPatient);
      repository.findVitalSignsByPatientId = jest.fn().mockResolvedValue([baseVital]);

      const result = await service.listVitalSigns(mockFamilyRep, 'patient-uuid-1', 14);

      expect(repository.findVitalSignsByPatientId).toHaveBeenCalledWith(
        'patient-uuid-1',
        expect.any(Date),
      );
      expect(result).toHaveLength(1);
    });

    it('chặn sửa hoặc xóa chỉ số sinh tồn gắn với EMR bác sĩ (emrId !== null)', async () => {
      repository.findById.mockResolvedValue(mockPatient);
      repository.findVitalSignById = jest.fn().mockResolvedValue({
        ...baseVital,
        emrId: 'emr-doctor-1',
      });
      repository.updateVitalSign = jest.fn();
      repository.deleteVitalSign = jest.fn();

      await expect(
        service.updateVitalSign(mockFamilyRep, 'patient-uuid-1', 'vit-1', { heartRate: 80 }),
      ).rejects.toThrow(ForbiddenException);

      await expect(
        service.deleteVitalSign(mockFamilyRep, 'patient-uuid-1', 'vit-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('sửa và xóa chỉ số sinh tồn do gia đình nhập (emrId === null) thành công', async () => {
      repository.findById.mockResolvedValue(mockPatient);
      repository.findVitalSignById = jest.fn().mockResolvedValue(baseVital);
      repository.updateVitalSign = jest.fn().mockResolvedValue({
        ...baseVital,
        systolicBp: 120,
        diastolicBp: 78,
        isAbnormalAlert: false,
      });
      repository.deleteVitalSign = jest.fn().mockResolvedValue(baseVital);

      const updated = await service.updateVitalSign(mockFamilyRep, 'patient-uuid-1', 'vit-1', {
        systolicBp: 120,
        diastolicBp: 78,
      });
      expect(repository.updateVitalSign).toHaveBeenCalledWith(
        'vit-1',
        { systolicBp: 120, diastolicBp: 78 },
        false,
      );
      expect(updated.isAbnormalAlert).toBe(false);

      const deleted = await service.deleteVitalSign(mockFamilyRep, 'patient-uuid-1', 'vit-1');
      expect(repository.deleteVitalSign).toHaveBeenCalledWith('vit-1');
      expect(deleted.id).toBe('vit-1');
    });
  });
});
