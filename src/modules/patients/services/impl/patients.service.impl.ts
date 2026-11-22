import type { Readable } from 'stream';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../../../../core/auth/authenticated-request';
import { StorageService } from '../../../../core/services/storage.service';
import { validateUploadedDocumentFile } from '../../../../core/validation/document-file.validator';
import { buildMediaUrl } from '../../../../shared/utils/media-url.util';
import type { CreatePatientDto } from '../../dtos/create-patient.dto';
import type { UpdatePatientDto } from '../../dtos/update-patient.dto';
import type { CreateAllergyDto } from '../../dtos/create-allergy.dto';
import type { CreatePatientDocumentDto } from '../../dtos/create-patient-document.dto';
import type { CreateVitalSignDto } from '../../dtos/create-vital-sign.dto';
import type { UpdateVitalSignDto } from '../../dtos/update-vital-sign.dto';
import {
  PATIENTS_REPOSITORY_TOKEN,
  type DuplicatePatientConflict,
  type IPatientsRepository,
  type PatientDetail,
  type SerializedPatientDocument,
  type SerializedVitalSign,
} from '../../repositories/interfaces/patients.repository.interface';
import type { IPatientsService } from '../interfaces/patients.service.interface';
import type { Patient, PatientAllergy, PatientDocument, VitalSign } from '@prisma/client';
import {
  computeVitalAbnormalAlert,
  hasAnyVitalMetric,
} from '../../utils/vital-sign.util';

const DUPLICATE_CONFLICT_MESSAGES: Record<DuplicatePatientConflict, string> = {
  SELF: 'Hộ gia đình đã có hồ sơ chủ hộ (SELF) đang hoạt động',
};

@Injectable()
export class PatientsServiceImpl implements IPatientsService {
  constructor(
    @Inject(PATIENTS_REPOSITORY_TOKEN)
    private readonly repository: IPatientsRepository,
    @Optional()
    private readonly storage?: StorageService,
  ) {}

  private validateDateOfBirth(rawDate: string): void {
    const parsed = new Date(rawDate);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException('Ngày tháng năm sinh không hợp lệ');
    }

    const dobIso = parsed.toISOString().slice(0, 10);
    const todayVn = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh',
    }).format(new Date());

    if (dobIso > todayVn) {
      throw new BadRequestException('Ngày sinh không thể là ngày trong tương lai');
    }

    const minYear = Number(todayVn.slice(0, 4)) - 120;
    const minDobIso = `${String(minYear).padStart(4, '0')}${todayVn.slice(4)}`;
    if (dobIso < minDobIso) {
      throw new BadRequestException('Ngày sinh không hợp lệ (tuổi vượt quá 120 năm)');
    }
  }

  private async resolveFamilyId(
    user: AuthenticatedUser,
    familyIdFromDto?: string,
  ): Promise<string> {
    if (user.role === 'ADMIN') {
      if (!familyIdFromDto) {
        throw new BadRequestException('familyId is required for admin when creating patient');
      }
      return familyIdFromDto;
    }

    if (user.role === 'FAMILY_REP') {
      if (user.familyUnitId) {
        return user.familyUnitId;
      }
      const family = await this.repository.findFamilyUnitByRepresentativeUserId(user.id);
      if (!family) {
        throw new ForbiddenException('Family unit not found for representative');
      }
      return family.id;
    }

    throw new ForbiddenException('Only FAMILY_REP and ADMIN are allowed');
  }

  private async assertPatientAccess(
    user: AuthenticatedUser,
    patientId: string,
  ): Promise<PatientDetail> {
    const patient = await this.repository.findById(patientId);
    if (!patient) {
      throw new NotFoundException(`Patient with ID ${patientId} not found`);
    }

    if (user.role === 'ADMIN') {
      return patient;
    }

    if (user.role === 'FAMILY_REP') {
      let repFamilyId = user.familyUnitId;
      if (!repFamilyId) {
        const family = await this.repository.findFamilyUnitByRepresentativeUserId(user.id);
        repFamilyId = family?.id ?? null;
      }

      if (patient.familyId !== repFamilyId) {
        throw new ForbiddenException('Access denied to patient profile');
      }

      return patient;
    }

    throw new ForbiddenException('Access denied');
  }

  private async assertNoFallbackDuplicate(
    familyId: string,
    dto: CreatePatientDto,
  ): Promise<void> {
    if (!this.repository.findActiveDuplicateByFamilyId) {
      return;
    }

    const normalizedRelationship = (
      dto.relationshipToRepresentative ||
      dto.relationshipToHead ||
      ''
    )
      .trim()
      .toUpperCase();

    const conflict = await this.repository.findActiveDuplicateByFamilyId(familyId, {
      checkSelf: normalizedRelationship === 'SELF',
    });
    if (conflict) {
      throw new ConflictException(DUPLICATE_CONFLICT_MESSAGES[conflict]);
    }
  }

  async createPatient(user: AuthenticatedUser, dto: CreatePatientDto): Promise<Patient> {
    this.validateDateOfBirth(dto.dateOfBirth);
    const familyId = await this.resolveFamilyId(user, dto.familyId);

    if (this.repository.createWithActiveContractLock) {
      return this.repository.createWithActiveContractLock(familyId, dto);
    }

    if (this.repository.findActiveContractByFamilyId) {
      const activeContract =
        await this.repository.findActiveContractByFamilyId(familyId);
      if (!activeContract) {
        throw new ForbiddenException(
          'Hộ gia đình cần đăng ký và kích hoạt gói dịch vụ (ACTIVE) trước khi thêm thành viên',
        );
      }

      if (this.repository.countPatientsByFamilyId) {
        const currentCount =
          await this.repository.countPatientsByFamilyId(familyId);
        if (currentCount >= activeContract.memberCount) {
          throw new BadRequestException(
            `Hộ gia đình đã đạt giới hạn tối đa ${activeContract.memberCount} thành viên của gói hiện tại. Vui lòng nâng cấp gói hoặc mua phụ lục bổ sung.`,
          );
        }
      }

      await this.assertNoFallbackDuplicate(familyId, dto);

      if (this.repository.createAndAttachToContract) {
        return this.repository.createAndAttachToContract(
          familyId,
          activeContract.id,
          dto,
        );
      }
    }

    await this.assertNoFallbackDuplicate(familyId, dto);

    return this.repository.create(familyId, dto);
  }

  async listFamilyMembers(user: AuthenticatedUser): Promise<Patient[]> {
    if (user.role === 'ADMIN') {
      return this.repository.findAll();
    }

    if (user.role === 'FAMILY_REP') {
      const familyId = await this.resolveFamilyId(user);
      return this.repository.findByFamilyId(familyId);
    }

    throw new ForbiddenException('Access denied');
  }

  async getPatientById(user: AuthenticatedUser, id: string): Promise<PatientDetail> {
    const patient = await this.assertPatientAccess(user, id);
    if (!patient.documents) return patient;
    return {
      ...patient,
      documents: patient.documents.map((doc) => this.serializeDocument(doc)),
    };
  }

  async updatePatient(
    user: AuthenticatedUser,
    id: string,
    dto: UpdatePatientDto,
  ): Promise<Patient> {
    await this.assertPatientAccess(user, id);
    return this.repository.update(id, dto);
  }

  async detachPatient(user: AuthenticatedUser, id: string): Promise<Patient> {
    const patient = await this.assertPatientAccess(user, id);
    if ((patient.relationshipToHead || '').trim().toUpperCase() === 'SELF') {
      throw new BadRequestException(
        'Không thể tách chủ hộ khỏi sổ hộ tịch gia đình',
      );
    }
    if (patient.status === 'INACTIVE') {
      throw new BadRequestException(
        'Thành viên này đã được tách khỏi hộ gia đình',
      );
    }
    if (this.repository.softDeactivate) {
      return this.repository.softDeactivate(id);
    }
    return this.repository.update(id, { status: 'INACTIVE' });
  }

  async addAllergy(
    user: AuthenticatedUser,
    patientId: string,
    dto: CreateAllergyDto,
  ): Promise<PatientAllergy> {
    await this.assertPatientAccess(user, patientId);
    return this.repository.addAllergy(patientId, dto);
  }

  async listAllergies(
    user: AuthenticatedUser,
    patientId: string,
  ): Promise<PatientAllergy[]> {
    await this.assertPatientAccess(user, patientId);
    return this.repository.findAllergiesByPatientId(patientId);
  }

  private serializeDocument(doc: PatientDocument): SerializedPatientDocument {
    const isExternal = /^https?:\/\//i.test(doc.fileUrl);
    const isImage = Boolean(
      doc.mimeType?.startsWith('image/') ||
        /\.(png|jpe?g|webp)$/i.test(doc.fileUrl),
    );
    const downloadPath = isExternal
      ? doc.fileUrl
      : `/api/v1/patients/${doc.patientId}/documents/${doc.id}/file`;

    let previewUrl: string | null = null;
    if (isImage) {
      if (isExternal) {
        previewUrl = doc.fileUrl;
      } else if (
        process.env.MEDIA_BASE_URL &&
        process.env.IMGPROXY_KEY &&
        process.env.IMGPROXY_SALT
      ) {
        previewUrl = buildMediaUrl(doc.fileUrl, {
          width: 900,
          height: 0,
          resizingType: 'fit',
          format: 'webp',
        });
      }
    }

    return {
      ...doc,
      previewUrl,
      downloadPath,
    };
  }

  async addDocument(
    user: AuthenticatedUser,
    patientId: string,
    dto: CreatePatientDocumentDto,
    file?: Express.Multer.File,
  ): Promise<SerializedPatientDocument> {
    await this.assertPatientAccess(user, patientId);

    let resolvedFileUrl = dto.fileUrl?.trim() || '';
    let resolvedMimeType = dto.mimeType?.trim() || null;
    let resolvedSizeKb = dto.fileSizeKb ?? 0;

    if (file) {
      const validated = validateUploadedDocumentFile(file, {
        label: 'Tài liệu y tế',
      });
      if (!this.storage) {
        throw new NotFoundException('Dịch vụ lưu trữ tài liệu chưa khả dụng');
      }
      resolvedFileUrl = await this.storage.uploadFile(
        {
          ...file,
          buffer: validated.buffer,
          mimetype: validated.contentType,
          originalname: `document.${validated.extension}`,
        },
        `patient-documents/${patientId}`,
      );
      resolvedMimeType = validated.contentType;
      resolvedSizeKb =
        dto.fileSizeKb !== undefined
          ? dto.fileSizeKb
          : Math.max(1, Math.round(validated.buffer.length / 1024));
    } else {
      if (!resolvedFileUrl || !/^https?:\/\//i.test(resolvedFileUrl)) {
        throw new BadRequestException(
          'Vui lòng tải lên tệp PDF/PNG/JPG hoặc cung cấp đường dẫn http(s) hợp lệ',
        );
      }
      if (!resolvedMimeType && /\.(png|jpe?g|webp)(\?|$)/i.test(resolvedFileUrl)) {
        resolvedMimeType = 'image/jpeg';
      } else if (!resolvedMimeType && /\.pdf(\?|$)/i.test(resolvedFileUrl)) {
        resolvedMimeType = 'application/pdf';
      }
    }

    const created = await this.repository.addDocument(patientId, {
      documentName: dto.documentName.trim(),
      documentType: dto.documentType,
      fileUrl: resolvedFileUrl,
      mimeType: resolvedMimeType,
      notes: dto.notes?.trim() || null,
      fileSizeKb: resolvedSizeKb,
      recordedDate: dto.recordedDate,
    });
    return this.serializeDocument(created);
  }

  async listDocuments(
    user: AuthenticatedUser,
    patientId: string,
  ): Promise<SerializedPatientDocument[]> {
    await this.assertPatientAccess(user, patientId);
    const docs = await this.repository.findDocumentsByPatientId(patientId);
    return docs.map((doc) => this.serializeDocument(doc));
  }

  private async resolveInternalDocument(
    user: AuthenticatedUser,
    patientId: string,
    documentId: string,
  ): Promise<{ storage: StorageService; document: PatientDocument }> {
    await this.assertPatientAccess(user, patientId);
    if (!this.repository.findDocumentById || !this.storage) {
      throw new NotFoundException('Chức năng tải tệp tài liệu chưa khả dụng');
    }
    const existing = await this.repository.findDocumentById(documentId);
    if (!existing || existing.patientId !== patientId) {
      throw new NotFoundException('Không tìm thấy tài liệu y tế');
    }
    if (/^https?:\/\//i.test(existing.fileUrl)) {
      throw new BadRequestException('Tài liệu dùng đường dẫn ngoài, không lưu trữ nội bộ');
    }
    return { storage: this.storage, document: existing };
  }

  async getDocumentFile(
    user: AuthenticatedUser,
    patientId: string,
    documentId: string,
  ): Promise<{ bytes: Buffer; contentType: string }> {
    const { storage, document } = await this.resolveInternalDocument(
      user,
      patientId,
      documentId,
    );
    const downloaded = await storage.downloadFile(document.fileUrl);
    return {
      bytes: downloaded.bytes,
      contentType: document.mimeType || downloaded.contentType,
    };
  }

  async getDocumentFileStream(
    user: AuthenticatedUser,
    patientId: string,
    documentId: string,
  ): Promise<{ stream: Readable; contentType: string; contentLength?: number }> {
    const { storage, document } = await this.resolveInternalDocument(
      user,
      patientId,
      documentId,
    );
    const downloaded = await storage.downloadFileStream(document.fileUrl);
    return {
      stream: downloaded.stream,
      contentType: document.mimeType || downloaded.contentType,
      contentLength: downloaded.contentLength,
    };
  }

  async deleteDocument(
    user: AuthenticatedUser,
    patientId: string,
    documentId: string,
  ): Promise<SerializedPatientDocument> {
    await this.assertPatientAccess(user, patientId);
    if (!this.repository.findDocumentById || !this.repository.deleteDocument) {
      throw new NotFoundException('Chức năng xóa tài liệu y tế chưa khả dụng');
    }
    const existing = await this.repository.findDocumentById(documentId);
    if (!existing || existing.patientId !== patientId) {
      throw new NotFoundException('Không tìm thấy tài liệu y tế');
    }
    const deleted = await this.repository.deleteDocument(documentId);
    if (this.storage && !/^https?:\/\//i.test(existing.fileUrl)) {
      await this.storage.deleteFile(existing.fileUrl);
    }
    return this.serializeDocument(deleted);
  }

  private serializeVitalSign(vital: VitalSign): SerializedVitalSign {
    return {
      ...vital,
      temperature:
        vital.temperature !== null && vital.temperature !== undefined
          ? Number(vital.temperature)
          : null,
      bloodGlucose:
        vital.bloodGlucose !== null && vital.bloodGlucose !== undefined
          ? Number(vital.bloodGlucose)
          : null,
    };
  }

  async deleteAllergy(
    user: AuthenticatedUser,
    patientId: string,
    allergyId: string,
  ): Promise<PatientAllergy> {
    await this.assertPatientAccess(user, patientId);
    if (!this.repository.findAllergyById || !this.repository.deleteAllergy) {
      throw new NotFoundException('Chức năng xóa dị ứng chưa khả dụng');
    }
    const existing = await this.repository.findAllergyById(allergyId);
    if (!existing || existing.patientId !== patientId) {
      throw new NotFoundException('Không tìm thấy thông tin dị ứng của bệnh nhân');
    }
    return this.repository.deleteAllergy(allergyId);
  }

  async addVitalSign(
    user: AuthenticatedUser,
    patientId: string,
    dto: CreateVitalSignDto,
  ): Promise<SerializedVitalSign> {
    await this.assertPatientAccess(user, patientId);
    if (!hasAnyVitalMetric(dto)) {
      throw new BadRequestException('Vui lòng nhập ít nhất một chỉ số sinh tồn');
    }
    if (!this.repository.addVitalSign) {
      throw new NotFoundException('Chức năng lưu chỉ số sinh tồn chưa khả dụng');
    }
    const isAbnormalAlert = computeVitalAbnormalAlert(dto);
    const created = await this.repository.addVitalSign(patientId, dto, isAbnormalAlert);
    return this.serializeVitalSign(created);
  }

  async listVitalSigns(
    user: AuthenticatedUser,
    patientId: string,
    days = 30,
  ): Promise<SerializedVitalSign[]> {
    await this.assertPatientAccess(user, patientId);
    if (!this.repository.findVitalSignsByPatientId) {
      return [];
    }
    const clampedDays = Number.isFinite(days)
      ? Math.min(90, Math.max(1, Math.trunc(days)))
      : 30;
    const sinceDate = new Date(Date.now() - clampedDays * 86_400_000);
    const list = await this.repository.findVitalSignsByPatientId(patientId, sinceDate);
    return list.map((item) => this.serializeVitalSign(item));
  }

  async updateVitalSign(
    user: AuthenticatedUser,
    patientId: string,
    vitalId: string,
    dto: UpdateVitalSignDto,
  ): Promise<SerializedVitalSign> {
    await this.assertPatientAccess(user, patientId);
    if (!this.repository.findVitalSignById || !this.repository.updateVitalSign) {
      throw new NotFoundException('Chức năng cập nhật chỉ số sinh tồn chưa khả dụng');
    }
    const existing = await this.repository.findVitalSignById(vitalId);
    if (!existing || existing.patientId !== patientId) {
      throw new NotFoundException('Không tìm thấy bản ghi chỉ số sinh tồn');
    }
    if (existing.emrId !== null) {
      throw new ForbiddenException(
        'Chỉ có thể chỉnh sửa chỉ số sinh tồn do gia đình tự ghi nhận',
      );
    }

    const merged = {
      systolicBp: dto.systolicBp !== undefined ? dto.systolicBp : existing.systolicBp,
      diastolicBp: dto.diastolicBp !== undefined ? dto.diastolicBp : existing.diastolicBp,
      heartRate: dto.heartRate !== undefined ? dto.heartRate : existing.heartRate,
      temperature:
        dto.temperature !== undefined
          ? dto.temperature
          : existing.temperature !== null
            ? Number(existing.temperature)
            : null,
      spo2: dto.spo2 !== undefined ? dto.spo2 : existing.spo2,
      respiratoryRate:
        dto.respiratoryRate !== undefined ? dto.respiratoryRate : existing.respiratoryRate,
      bloodGlucose:
        dto.bloodGlucose !== undefined
          ? dto.bloodGlucose
          : existing.bloodGlucose !== null
            ? Number(existing.bloodGlucose)
            : null,
    };

    if (!hasAnyVitalMetric(merged)) {
      throw new BadRequestException('Vui lòng giữ lại ít nhất một chỉ số sinh tồn');
    }

    const isAbnormalAlert = computeVitalAbnormalAlert(merged);
    const updated = await this.repository.updateVitalSign(vitalId, dto, isAbnormalAlert);
    return this.serializeVitalSign(updated);
  }

  async deleteVitalSign(
    user: AuthenticatedUser,
    patientId: string,
    vitalId: string,
  ): Promise<SerializedVitalSign> {
    await this.assertPatientAccess(user, patientId);
    if (!this.repository.findVitalSignById || !this.repository.deleteVitalSign) {
      throw new NotFoundException('Chức năng xóa chỉ số sinh tồn chưa khả dụng');
    }
    const existing = await this.repository.findVitalSignById(vitalId);
    if (!existing || existing.patientId !== patientId) {
      throw new NotFoundException('Không tìm thấy bản ghi chỉ số sinh tồn');
    }
    if (existing.emrId !== null) {
      throw new ForbiddenException(
        'Không thể xóa chỉ số sinh tồn gắn với bệnh án của bác sĩ',
      );
    }
    const deleted = await this.repository.deleteVitalSign(vitalId);
    return this.serializeVitalSign(deleted);
  }
}
