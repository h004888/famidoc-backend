import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../core/database/prisma.service';
import type {
  IPatientsRepository,
  PatientDetail,
} from '../interfaces/patients.repository.interface';
import type { CreatePatientDto } from '../../dtos/create-patient.dto';
import type { UpdatePatientDto } from '../../dtos/update-patient.dto';
import type { CreateAllergyDto } from '../../dtos/create-allergy.dto';
import type { CreatePatientDocumentDto } from '../../dtos/create-patient-document.dto';
import type { FamilyUnit, Patient, PatientAllergy, PatientDocument } from '@prisma/client';

@Injectable()
export class PatientsRepositoryImpl implements IPatientsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private buildPatientCreateData(familyId: string, data: CreatePatientDto) {
    const relationship = data.relationshipToRepresentative || data.relationshipToHead || 'OTHER';
    const citizenId = data.identityNumber || data.citizenId || null;

    return {
      familyId,
      fullName: data.fullName,
      dateOfBirth: new Date(data.dateOfBirth),
      gender: data.gender,
      relationshipToHead: relationship,
      citizenId,
      healthInsuranceNumber: data.healthInsuranceNumber || null,
      bloodType: data.bloodType?.trim() || null,
      registeredHospital: data.registeredHospital?.trim() || null,
      chronicDiseases: data.chronicDiseases?.trim() || null,
      status: 'ACTIVE' as const,
    };
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
    const citizenId = data.identityNumber || data.citizenId;

    return this.prisma.patient.update({
      where: { id },
      data: {
        fullName: data.fullName,
        dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth) : undefined,
        gender: data.gender,
        relationshipToHead: relationship,
        citizenId: citizenId !== undefined ? citizenId : undefined,
        healthInsuranceNumber: data.healthInsuranceNumber !== undefined ? data.healthInsuranceNumber : undefined,
        bloodType: data.bloodType !== undefined ? (data.bloodType?.trim() || null) : undefined,
        registeredHospital:
          data.registeredHospital !== undefined ? (data.registeredHospital?.trim() || null) : undefined,
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
}
