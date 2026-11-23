import type { Patient, PatientAllergy, PatientChronicCondition } from '@prisma/client';
import type { AuthenticatedUser } from '../../../../core/auth/authenticated-request';
import type { CreatePatientDto } from '../../dtos/create-patient.dto';
import type { UpdatePatientDto } from '../../dtos/update-patient.dto';
import type { CreateAllergyDto } from '../../dtos/create-allergy.dto';
import type { CreateChronicConditionDto } from '../../dtos/create-chronic-condition.dto';
import type { UpdateChronicConditionDto } from '../../dtos/update-chronic-condition.dto';
import type { CreatePatientDocumentDto } from '../../dtos/create-patient-document.dto';
import type { CreateVitalSignDto } from '../../dtos/create-vital-sign.dto';
import type { UpdateVitalSignDto } from '../../dtos/update-vital-sign.dto';
import type {
  PatientDetail,
  SerializedPatientDocument,
  SerializedVitalSign,
} from '../../repositories/interfaces/patients.repository.interface';

export const PATIENTS_SERVICE_TOKEN = Symbol('PATIENTS_SERVICE');

export interface IPatientsService {
  createPatient(user: AuthenticatedUser, dto: CreatePatientDto): Promise<Patient>;
  listFamilyMembers(user: AuthenticatedUser): Promise<Patient[]>;
  getPatientById(user: AuthenticatedUser, id: string): Promise<PatientDetail>;
  updatePatient(user: AuthenticatedUser, id: string, dto: UpdatePatientDto): Promise<Patient>;
  detachPatient(user: AuthenticatedUser, id: string): Promise<Patient>;
  addAllergy(user: AuthenticatedUser, patientId: string, dto: CreateAllergyDto): Promise<PatientAllergy>;
  listAllergies(user: AuthenticatedUser, patientId: string): Promise<PatientAllergy[]>;
  deleteAllergy(user: AuthenticatedUser, patientId: string, allergyId: string): Promise<PatientAllergy>;
  addChronicCondition(
    user: AuthenticatedUser,
    patientId: string,
    dto: CreateChronicConditionDto,
  ): Promise<PatientChronicCondition>;
  listChronicConditions(
    user: AuthenticatedUser,
    patientId: string,
  ): Promise<PatientChronicCondition[]>;
  updateChronicCondition(
    user: AuthenticatedUser,
    patientId: string,
    conditionId: string,
    dto: UpdateChronicConditionDto,
  ): Promise<PatientChronicCondition>;
  deleteChronicCondition(
    user: AuthenticatedUser,
    patientId: string,
    conditionId: string,
  ): Promise<PatientChronicCondition>;
  addDocument(
    user: AuthenticatedUser,
    patientId: string,
    dto: CreatePatientDocumentDto,
    file?: Express.Multer.File,
  ): Promise<SerializedPatientDocument>;
  listDocuments(
    user: AuthenticatedUser,
    patientId: string,
  ): Promise<SerializedPatientDocument[]>;
  getDocumentFile(
    user: AuthenticatedUser,
    patientId: string,
    documentId: string,
  ): Promise<{ bytes: Buffer; contentType: string }>;
  deleteDocument(
    user: AuthenticatedUser,
    patientId: string,
    documentId: string,
  ): Promise<SerializedPatientDocument>;
  addVitalSign(user: AuthenticatedUser, patientId: string, dto: CreateVitalSignDto): Promise<SerializedVitalSign>;
  listVitalSigns(user: AuthenticatedUser, patientId: string, days?: number): Promise<SerializedVitalSign[]>;
  updateVitalSign(
    user: AuthenticatedUser,
    patientId: string,
    vitalId: string,
    dto: UpdateVitalSignDto,
  ): Promise<SerializedVitalSign>;
  deleteVitalSign(user: AuthenticatedUser, patientId: string, vitalId: string): Promise<SerializedVitalSign>;
}
