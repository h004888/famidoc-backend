import type { Patient, PatientAllergy, PatientDocument } from '@prisma/client';
import type { AuthenticatedUser } from '../../../../core/auth/authenticated-request';
import type { CreatePatientDto } from '../../dtos/create-patient.dto';
import type { UpdatePatientDto } from '../../dtos/update-patient.dto';
import type { CreateAllergyDto } from '../../dtos/create-allergy.dto';
import type { CreatePatientDocumentDto } from '../../dtos/create-patient-document.dto';
import type { PatientDetail } from '../../repositories/interfaces/patients.repository.interface';

export const PATIENTS_SERVICE_TOKEN = Symbol('PATIENTS_SERVICE');

export interface IPatientsService {
  createPatient(user: AuthenticatedUser, dto: CreatePatientDto): Promise<Patient>;
  listFamilyMembers(user: AuthenticatedUser): Promise<Patient[]>;
  getPatientById(user: AuthenticatedUser, id: string): Promise<PatientDetail>;
  updatePatient(user: AuthenticatedUser, id: string, dto: UpdatePatientDto): Promise<Patient>;
  addAllergy(user: AuthenticatedUser, patientId: string, dto: CreateAllergyDto): Promise<PatientAllergy>;
  listAllergies(user: AuthenticatedUser, patientId: string): Promise<PatientAllergy[]>;
  addDocument(user: AuthenticatedUser, patientId: string, dto: CreatePatientDocumentDto): Promise<PatientDocument>;
  listDocuments(user: AuthenticatedUser, patientId: string): Promise<PatientDocument[]>;
}
