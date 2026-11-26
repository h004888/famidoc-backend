import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../core/database/prisma.service';
import type {
  CreatePatientDocumentRecordInput,
  DuplicatePatientConflict,
  IPatientsRepository,
  PatientDetail,
  PatientDuplicateCriteria,
} from '../interfaces/patients.repository.interface';
import type { CreatePatientDto } from '../../dtos/create-patient.dto';
import type { UpdatePatientDto } from '../../dtos/update-patient.dto';
import type { CreateAllergyDto } from '../../dtos/create-allergy.dto';
import type { CreateChronicConditionDto } from '../../dtos/create-chronic-condition.dto';
import type { UpdateChronicConditionDto } from '../../dtos/update-chronic-condition.dto';
import type { CreateVitalSignDto } from '../../dtos/create-vital-sign.dto';
import type { UpdateVitalSignDto } from '../../dtos/update-vital-sign.dto';
import type {
  FamilyUnit,
  Patient,
  PatientAllergy,
  PatientChronicCondition,
  PatientDocument,
  Prisma,
  VitalSign,
} from '@prisma/client';

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

  private resolveChronicConditionInputs(data: {
    chronicConditions?: CreateChronicConditionDto[];
    chronicDiseases?: string;
  }): CreateChronicConditionDto[] | undefined {
    if (data.chronicConditions !== undefined) {
      const seen = new Set<string>();
      const cleaned: CreateChronicConditionDto[] = [];
      for (const item of data.chronicConditions) {
        const name = item.conditionName?.trim();
        if (!name) continue;
        const key = name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        cleaned.push({
          conditionName: name,
          icd10Code: item.icd10Code?.trim() || undefined,
          clinicalStatus: item.clinicalStatus ?? 'ACTIVE',
          diagnosedAt: item.diagnosedAt || undefined,
          notes: item.notes?.trim() || undefined,
        });
      }
      return cleaned;
    }

    if (data.chronicDiseases !== undefined) {
      const seen = new Set<string>();
      const cleaned: CreateChronicConditionDto[] = [];
      for (const part of data.chronicDiseases.split(/[,;]+/)) {
        const name = part.trim();
        if (!name) continue;
        const key = name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        cleaned.push({ conditionName: name, clinicalStatus: 'ACTIVE' });
      }
      return cleaned;
    }

    return undefined;
  }

  private buildChronicDiseasesSummary(items: Array<{ conditionName: string }>): string | null {
    if (!items.length) return null;
    return items.map((i) => i.conditionName.trim()).filter(Boolean).join(', ') || null;
  }

  private async syncPatientChronicSummary(
    tx: Prisma.TransactionClient,
    patientId: string,
  ): Promise<void> {
    const rows = await tx.patientChronicCondition.findMany({
      where: { patientId },
      orderBy: { createdAt: 'asc' },
      select: { conditionName: true },
    });
    await tx.patient.update({
      where: { id: patientId },
      data: { chronicDiseases: this.buildChronicDiseasesSummary(rows) },
    });
  }

  private buildPatientCreateData(familyId: string, data: CreatePatientDto) {
    const { relationship } = this.normalizeCreateFields(data);
    const resolvedConditions = this.resolveChronicConditionInputs(data);

    return {
      familyId,
      fullName: data.fullName.trim(),
      dateOfBirth: new Date(data.dateOfBirth),
      gender: data.gender,
      relationshipToHead: relationship,
      bloodType: data.bloodType?.trim() || null,
      heightCm: data.heightCm ?? null,
      weightKg: data.weightKg ?? null,
      chronicDiseases: resolvedConditions
        ? this.buildChronicDiseasesSummary(resolvedConditions)
        : data.chronicDiseases?.trim() || null,
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

      const resolvedConditions = this.resolveChronicConditionInputs(data);
      const patient = await tx.patient.create({
        data: {
          ...this.buildPatientCreateData(familyId, data),
          ...(resolvedConditions && resolvedConditions.length > 0
            ? {
                chronicConditions: {
                  create: resolvedConditions.map((c) => ({
                    conditionName: c.conditionName,
                    icd10Code: c.icd10Code ?? null,
                    clinicalStatus: c.clinicalStatus ?? 'ACTIVE',
                    diagnosedAt: c.diagnosedAt ? new Date(c.diagnosedAt) : null,
                    notes: c.notes ?? null,
                  })),
                },
              }
            : {}),
        },
        include: {
          allergies: { orderBy: { createdAt: 'desc' } },
          chronicConditions: { orderBy: { createdAt: 'desc' } },
        },
      });
      await tx.contractMember.create({
        data: {
          contractId: activeContract.id,
          patientId: patient.id,
        },
      });
      await this.syncPatientToUpcomingPeriodicEncounters(
        tx,
        activeContract.id,
        patient.id,
      );
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
      await this.syncPatientToUpcomingPeriodicEncounters(
        tx,
        contractId,
        patient.id,
      );
      return patient;
    });
  }

  private async syncPatientToUpcomingPeriodicEncounters(
    tx: Prisma.TransactionClient,
    contractId: string,
    patientId: string,
  ): Promise<void> {
    const txAny = tx as unknown as {
      encounter?: { findMany?: typeof tx.encounter.findMany };
      encounterParticipant?: {
        createMany?: typeof tx.encounterParticipant.createMany;
      };
    };
    if (!txAny.encounter?.findMany || !txAny.encounterParticipant?.createMany) {
      return;
    }

    const upcomingPeriodicEncounters = await tx.encounter.findMany({
      where: {
        contractId,
        category: 'PERIODIC_ROUTINE',
        visitScope: 'FAMILY',
        encounterStatus: { in: ['REQUESTED', 'CONFIRMED'] },
      },
      select: { id: true },
    });

    if (upcomingPeriodicEncounters.length === 0) {
      return;
    }

    await tx.encounterParticipant.createMany({
      data: upcomingPeriodicEncounters.map((enc) => ({
        encounterId: enc.id,
        patientId,
      })),
      skipDuplicates: true,
    });
  }

  findById(id: string): Promise<PatientDetail | null> {
    return this.prisma.patient.findUnique({
      where: { id },
      include: {
        allergies: {
          orderBy: { createdAt: 'desc' },
        },
        chronicConditions: {
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
        chronicConditions: {
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
    const resolvedConditions = this.resolveChronicConditionInputs(data);

    return this.prisma.$transaction(async (tx) => {
      if (resolvedConditions !== undefined) {
        await tx.patientChronicCondition.deleteMany({ where: { patientId: id } });
        if (resolvedConditions.length > 0) {
          await tx.patientChronicCondition.createMany({
            data: resolvedConditions.map((c) => ({
              patientId: id,
              conditionName: c.conditionName,
              icd10Code: c.icd10Code ?? null,
              clinicalStatus: c.clinicalStatus ?? 'ACTIVE',
              diagnosedAt: c.diagnosedAt ? new Date(c.diagnosedAt) : null,
              notes: c.notes ?? null,
            })),
          });
        }
      }

      return tx.patient.update({
        where: { id },
        data: {
          fullName: data.fullName,
          dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth) : undefined,
          gender: data.gender,
          relationshipToHead: relationship,
          bloodType: data.bloodType !== undefined ? (data.bloodType?.trim() || null) : undefined,
          heightCm: data.heightCm !== undefined ? data.heightCm : undefined,
          weightKg: data.weightKg !== undefined ? data.weightKg : undefined,
          chronicDiseases:
            resolvedConditions !== undefined
              ? this.buildChronicDiseasesSummary(resolvedConditions)
              : undefined,
          status: data.status,
        },
        include: {
          allergies: { orderBy: { createdAt: 'desc' } },
          chronicConditions: { orderBy: { createdAt: 'desc' } },
        },
      });
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

  addDocument(patientId: string, data: CreatePatientDocumentRecordInput): Promise<PatientDocument> {
    return this.prisma.patientDocument.create({
      data: {
        patientId,
        documentName: data.documentName,
        documentType: data.documentType,
        fileUrl: data.fileUrl,
        mimeType: data.mimeType ?? null,
        notes: data.notes ?? null,
        fileSizeKb: data.fileSizeKb,
        recordedDate: new Date(data.recordedDate),
      },
    });
  }

  findDocumentsByPatientId(patientId: string): Promise<PatientDocument[]> {
    return this.prisma.patientDocument.findMany({
      where: { patientId },
      orderBy: [{ recordedDate: 'desc' }, { uploadedAt: 'desc' }],
    });
  }

  findDocumentById(documentId: string): Promise<PatientDocument | null> {
    return this.prisma.patientDocument.findUnique({
      where: { id: documentId },
    });
  }

  deleteDocument(documentId: string): Promise<PatientDocument> {
    return this.prisma.patientDocument.delete({
      where: { id: documentId },
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

  addChronicCondition(
    patientId: string,
    data: CreateChronicConditionDto,
  ): Promise<PatientChronicCondition> {
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.patientChronicCondition.create({
        data: {
          patientId,
          conditionName: data.conditionName.trim(),
          icd10Code: data.icd10Code?.trim() || null,
          clinicalStatus: data.clinicalStatus ?? 'ACTIVE',
          diagnosedAt: data.diagnosedAt ? new Date(data.diagnosedAt) : null,
          notes: data.notes?.trim() || null,
        },
      });
      await this.syncPatientChronicSummary(tx, patientId);
      return created;
    });
  }

  findChronicConditionsByPatientId(patientId: string): Promise<PatientChronicCondition[]> {
    return this.prisma.patientChronicCondition.findMany({
      where: { patientId },
      orderBy: { createdAt: 'desc' },
    });
  }

  findChronicConditionById(conditionId: string): Promise<PatientChronicCondition | null> {
    return this.prisma.patientChronicCondition.findUnique({
      where: { id: conditionId },
    });
  }

  updateChronicCondition(
    conditionId: string,
    data: UpdateChronicConditionDto,
  ): Promise<PatientChronicCondition> {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.patientChronicCondition.update({
        where: { id: conditionId },
        data: {
          conditionName: data.conditionName !== undefined ? data.conditionName.trim() : undefined,
          icd10Code: data.icd10Code !== undefined ? data.icd10Code?.trim() || null : undefined,
          clinicalStatus: data.clinicalStatus,
          diagnosedAt:
            data.diagnosedAt !== undefined
              ? data.diagnosedAt
                ? new Date(data.diagnosedAt)
                : null
              : undefined,
          notes: data.notes !== undefined ? data.notes?.trim() || null : undefined,
        },
      });
      await this.syncPatientChronicSummary(tx, updated.patientId);
      return updated;
    });
  }

  deleteChronicCondition(conditionId: string): Promise<PatientChronicCondition> {
    return this.prisma.$transaction(async (tx) => {
      const deleted = await tx.patientChronicCondition.delete({
        where: { id: conditionId },
      });
      await this.syncPatientChronicSummary(tx, deleted.patientId);
      return deleted;
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
        glucoseContext: data.glucoseContext ?? null,
        measurementState: data.measurementState ?? null,
        notes: data.notes?.trim() || null,
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
        OR: [{ emrId: null }, { clinicalEmr: { isFinalized: true } }],
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
        glucoseContext: data.glucoseContext !== undefined ? data.glucoseContext : undefined,
        measurementState: data.measurementState !== undefined ? data.measurementState : undefined,
        notes: data.notes !== undefined ? (data.notes?.trim() || null) : undefined,
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
