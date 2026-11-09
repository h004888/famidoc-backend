import type { FamilyUnit, Patient, PatientAllergy, PatientDocument } from '@prisma/client';
import type { CreatePatientDto } from '../../dtos/create-patient.dto';
import type { UpdatePatientDto } from '../../dtos/update-patient.dto';
import type { CreateAllergyDto } from '../../dtos/create-allergy.dto';
import type { CreatePatientDocumentDto } from '../../dtos/create-patient-document.dto';

export type PatientDetail = Patient & {
  allergies?: PatientAllergy[];
  documents?: PatientDocument[];
};

export const PATIENTS_REPOSITORY_TOKEN = Symbol('PATIENTS_REPOSITORY');

export interface IPatientsRepository {
  create(familyId: string, data: CreatePatientDto): Promise<Patient>;
  findById(id: string): Promise<PatientDetail | null>;
  findByFamilyId(familyId: string): Promise<Patient[]>;
  findAll(): Promise<Patient[]>;
  update(id: string, data: UpdatePatientDto): Promise<Patient>;
  findFamilyUnitByRepresentativeUserId(representativeUserId: string): Promise<FamilyUnit | null>;
  findFamilyUnitById(id: string): Promise<FamilyUnit | null>;
  addAllergy(patientId: string, data: CreateAllergyDto): Promise<PatientAllergy>;
  findAllergiesByPatientId(patientId: string): Promise<PatientAllergy[]>;
  addDocument(patientId: string, data: CreatePatientDocumentDto): Promise<PatientDocument>;
  findDocumentsByPatientId(patientId: string): Promise<PatientDocument[]>;
}
