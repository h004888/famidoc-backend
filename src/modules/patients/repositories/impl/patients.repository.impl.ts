import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../core/database/prisma.service';
import type {
  DuplicatePatientConflict,
  IPatientsRepository,
  PatientDetail,
  PatientDuplicateCriteria,
} from '../interfaces/patients.repository.interface';
import type { CreatePatientDto } from '../../dtos/create-patient.dto';
import type { UpdatePatientDto } from '../../dtos/update-patient.dto';
import type { CreateAllergyDto } from '../../dtos/create-allergy.dto';
import type { CreatePatientDocumentDto } from '../../dtos/create-patient-document.dto';
import type { CreateVitalSignDto } from '../../dtos/create-vital-sign.dto';
import type { UpdateVitalSignDto } from '../../dtos/update-vital-sign.dto';
import type { FamilyUnit, Patient, PatientAllergy, PatientDocument, VitalSign } from '@prisma/client';

const DUPLICATE_CONFLICT_MESSAGES: Record<DuplicatePatientConflict, string> = {
  SELF: 'Hộ gia đình đã có hồ sơ chủ hộ (SELF) đang hoạt động',
};

@Injectable()
export class PatientsRepositoryImpl implements IPatientsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private normalizeCreateFields(data: CreatePatientDto) {
    const relationship = (data.relationshipToRepresentative || data.relationshipToHead || 'OTHER').trim();

    return {
      relationship,
    };
  }

  private buildPatientCreateData(familyId: string, data: CreatePatientDto) {
    const { relationship } = this.normalizeCreateFields(data);

    return {
      familyId,
      fullName: data.fullName.trim(),
      dateOfBirth: new Date(data.dateOfBirth),
      gender: data.gender,
      relationshipToHead: relationship,
      bloodType: data.bloodType?.trim() || null,
      chronicDiseases: data.chronicDiseases?.trim() || null,
      status: 'ACTIVE' as const,
    };
  }

  private async findConflictInClient(
    client: Pick<PrismaService, 'patient'>,
    familyId: string,
    criteria: PatientDuplicateCriteria,
  ): Promise<DuplicatePatientConflict | null> {
    if (criteria.checkSelf) {
      const existingSelf = await client.patient.findFirst({
        where: {
          familyId,
          status: 'ACTIVE',
          relationshipToHead: { equals: 'SELF', mode: 'insensitive' },
        },
        select: { id: true },
      });
      if (existingSelf) return 'SELF';
    }

    return null;
  }

  findActiveDuplicateByFamilyId(
    familyId: string,
    criteria: PatientDuplicateCriteria,
  ): Promise<DuplicatePatientConflict | null> {
    return this.findConflictInClient(this.prisma, familyId, criteria);
  }

  create(familyId: string, data: CreatePatientDto): Promise<Patient> {
    return this.prisma.patient.create({
      data: this.buildPatientCreateData(familyId, data),
    });
  }

  async createWithActiveContractLock(
    familyId: string,
    data: CreatePatientDto,
  ): Promise<Patient> {
    return this.prisma.$transaction(async (tx) => {
      const lockedContracts = await tx.$queryRaw<
        Array<{ id: string; member_count: number }>
      >`
        SELECT id, member_count
        FROM medical_contracts
        WHERE family_id = ${familyId}::uuid
          AND contract_status = 'ACTIVE'
        ORDER BY created_at DESC
        LIMIT 1
        FOR UPDATE
      `;

      const activeContract = lockedContracts[0];
      if (!activeContract) {
        throw new ForbiddenException(
          'Hộ gia đình cần đăng ký và kích hoạt gói dịch vụ (ACTIVE) trước khi thêm thành viên',
        );
      }

      const currentCount = await tx.patient.count({
        where: { familyId, status: 'ACTIVE' },
      });
      if (currentCount >= activeContract.member_count) {
        throw new BadRequestException(
          `Hộ gia đình đã đạt giới hạn tối đa ${activeContract.member_count} thành viên của gói hiện tại. Vui lòng nâng cấp gói hoặc mua phụ lục bổ sung.`,
        );
      }

      const normalized = this.normalizeCreateFields(data);
      const conflict = await this.findConflictInClient(tx, familyId, {
        checkSelf: normalized.relationship.toUpperCase() === 'SELF',
      });
      if (conflict) {
        throw new ConflictException(DUPLICATE_CONFLICT_MESSAGES[conflict]);
      }

      const patient = await tx.patient.create({
        data: this.buildPatientCreateData(familyId, data),
      });
      await tx.contractMember.create({
        data: {
          contractId: activeContract.id,
          patientId: patient.id,
        },
      });
      return patient;
    });
  }

  async findActiveContractByFamilyId(
    familyId: string,
  ): Promise<{ id: string; memberCount: number } | null> {
    return this.prisma.medicalContract.findFirst({
      where: { familyId, contractStatus: 'ACTIVE' },
      select: { id: true, memberCount: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  countPatientsByFamilyId(familyId: string): Promise<number> {
    return this.prisma.patient.count({
      where: { familyId, status: 'ACTIVE' },
    });
  }

  createAndAttachToContract(
    familyId: string,
    contractId: string,
    data: CreatePatientDto,
  ): Promise<Patient> {
    return this.prisma.$transaction(async (tx) => {
      const patient = await tx.patient.create({
        data: this.buildPatientCreateData(familyId, data),
      });
      await tx.contractMember.create({
        data: {
          contractId,
          patientId: patient.id,
        },
      });
      return patient;
    });
  }

  findById(id: string): Promise<PatientDetail | null> {
    return this.prisma.patient.findUnique({
      where: { id },
      include: {
        allergies: {
          orderBy: { createdAt: 'desc' },
        },
        documents: {
          orderBy: { recordedDate: 'desc' },
        },
      },
    });
  }

  findByFamilyId(familyId: string): Promise<Patient[]> {
    return this.prisma.patient.findMany({
      where: { familyId, status: 'ACTIVE' },
      include: {
        allergies: {
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  findAll(): Promise<Patient[]> {
    return this.prisma.patient.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  update(id: string, data: UpdatePatientDto): Promise<Patient> {
    const relationship = data.relationshipToRepresentative || data.relationshipToHead;

    return this.prisma.patient.update({
      where: { id },
      data: {
        fullName: data.fullName,
        dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth) : undefined,
        gender: data.gender,
        relationshipToHead: relationship,
        bloodType: data.bloodType !== undefined ? (data.bloodType?.trim() || null) : undefined,
        chronicDiseases:
          data.chronicDiseases !== undefined ? (data.chronicDiseases?.trim() || null) : undefined,
        status: data.status,
      },
    });
  }

  softDeactivate(id: string): Promise<Patient> {
    return this.prisma.patient.update({
      where: { id },
      data: { status: 'INACTIVE' },
    });
  }

  findFamilyUnitByRepresentativeUserId(representativeUserId: string): Promise<FamilyUnit | null> {
    return this.prisma.familyUnit.findUnique({
      where: { representativeUserId },
    });
  }

  findFamilyUnitById(id: string): Promise<FamilyUnit | null> {
    return this.prisma.familyUnit.findUnique({
      where: { id },
    });
  }

  addAllergy(patientId: string, data: CreateAllergyDto): Promise<PatientAllergy> {
    return this.prisma.patientAllergy.create({
      data: {
        patientId,
        allergenType: data.allergenType,
        allergenName: data.allergenName,
        severity: data.severity,
        clinicalManifestation: data.clinicalManifestation || null,
      },
    });
  }

  findAllergiesByPatientId(patientId: string): Promise<PatientAllergy[]> {
    return this.prisma.patientAllergy.findMany({
      where: { patientId },
      orderBy: { createdAt: 'desc' },
    });
  }

  addDocument(patientId: string, data: CreatePatientDocumentDto): Promise<PatientDocument> {
    return this.prisma.patientDocument.create({
      data: {
        patientId,
        documentName: data.documentName,
        documentType: data.documentType,
        fileUrl: data.fileUrl,
        fileSizeKb: data.fileSizeKb,
        recordedDate: new Date(data.recordedDate),
      },
    });
  }

  findDocumentsByPatientId(patientId: string): Promise<PatientDocument[]> {
    return this.prisma.patientDocument.findMany({
      where: { patientId },
      orderBy: { recordedDate: 'desc' },
    });
  }

  findAllergyById(allergyId: string): Promise<PatientAllergy | null> {
    return this.prisma.patientAllergy.findUnique({
      where: { id: allergyId },
    });
  }

  deleteAllergy(allergyId: string): Promise<PatientAllergy> {
    return this.prisma.patientAllergy.delete({
      where: { id: allergyId },
    });
  }

  addVitalSign(
    patientId: string,
    data: CreateVitalSignDto,
    isAbnormalAlert: boolean,
  ): Promise<VitalSign> {
    return this.prisma.vitalSign.create({
      data: {
        patientId,
        emrId: null,
        systolicBp: data.systolicBp ?? null,
        diastolicBp: data.diastolicBp ?? null,
        heartRate: data.heartRate ?? null,
        temperature: data.temperature ?? null,
        spo2: data.spo2 ?? null,
        respiratoryRate: data.respiratoryRate ?? null,
        bloodGlucose: data.bloodGlucose ?? null,
        isAbnormalAlert,
        recordedAt: data.recordedAt ? new Date(data.recordedAt) : new Date(),
      },
    });
  }

  findVitalSignsByPatientId(patientId: string, sinceDate: Date): Promise<VitalSign[]> {
    return this.prisma.vitalSign.findMany({
      where: {
        patientId,
        recordedAt: { gte: sinceDate },
      },
      orderBy: { recordedAt: 'desc' },
    });
  }

  findVitalSignById(vitalId: string): Promise<VitalSign | null> {
    return this.prisma.vitalSign.findUnique({
      where: { id: vitalId },
    });
  }

  updateVitalSign(
    vitalId: string,
    data: UpdateVitalSignDto,
    isAbnormalAlert: boolean,
  ): Promise<VitalSign> {
    return this.prisma.vitalSign.update({
      where: { id: vitalId },
      data: {
        systolicBp: data.systolicBp !== undefined ? data.systolicBp : undefined,
        diastolicBp: data.diastolicBp !== undefined ? data.diastolicBp : undefined,
        heartRate: data.heartRate !== undefined ? data.heartRate : undefined,
        temperature: data.temperature !== undefined ? data.temperature : undefined,
        spo2: data.spo2 !== undefined ? data.spo2 : undefined,
        respiratoryRate: data.respiratoryRate !== undefined ? data.respiratoryRate : undefined,
        bloodGlucose: data.bloodGlucose !== undefined ? data.bloodGlucose : undefined,
        recordedAt: data.recordedAt ? new Date(data.recordedAt) : undefined,
        isAbnormalAlert,
      },
    });
  }

  deleteVitalSign(vitalId: string): Promise<VitalSign> {
    return this.prisma.vitalSign.delete({
      where: { id: vitalId },
    });
  }
}
