import { Injectable } from '@nestjs/common';
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

  create(familyId: string, data: CreatePatientDto): Promise<Patient> {
    const relationship = data.relationshipToRepresentative || data.relationshipToHead || 'OTHER';
    const citizenId = data.identityNumber || data.citizenId || null;

    return this.prisma.patient.create({
      data: {
        familyId,
        fullName: data.fullName,
        dateOfBirth: new Date(data.dateOfBirth),
        gender: data.gender,
        relationshipToHead: relationship,
        citizenId,
        healthInsuranceNumber: data.healthInsuranceNumber || null,
        status: 'ACTIVE',
      },
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
      where: { familyId },
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
        status: data.status,
      },
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
