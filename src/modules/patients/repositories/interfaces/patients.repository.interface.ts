import type { FamilyUnit, Patient, PatientAllergy, PatientDocument, VitalSign } from '@prisma/client';
import type { CreatePatientDto } from '../../dtos/create-patient.dto';
import type { UpdatePatientDto } from '../../dtos/update-patient.dto';
import type { CreateAllergyDto } from '../../dtos/create-allergy.dto';
import type { CreatePatientDocumentDto } from '../../dtos/create-patient-document.dto';
import type { CreateVitalSignDto } from '../../dtos/create-vital-sign.dto';
import type { UpdateVitalSignDto } from '../../dtos/update-vital-sign.dto';

export type PatientDetail = Patient & {
  allergies?: PatientAllergy[];
  documents?: PatientDocument[];
};

export type SerializedVitalSign = Omit<VitalSign, 'temperature' | 'bloodGlucose'> & {
  temperature: number | null;
  bloodGlucose: number | null;
};

export type DuplicatePatientConflict = 'SELF';

export interface PatientDuplicateCriteria {
  checkSelf?: boolean;
}

export const PATIENTS_REPOSITORY_TOKEN = Symbol('PATIENTS_REPOSITORY');

export interface IPatientsRepository {
  create(familyId: string, data: CreatePatientDto): Promise<Patient>;
  createWithActiveContractLock?(
    familyId: string,
    data: CreatePatientDto,
  ): Promise<Patient>;
  findActiveDuplicateByFamilyId?(
    familyId: string,
    criteria: PatientDuplicateCriteria,
  ): Promise<DuplicatePatientConflict | null>;
  createAndAttachToContract?(
    familyId: string,
    contractId: string,
    data: CreatePatientDto,
  ): Promise<Patient>;
  findActiveContractByFamilyId?(
    familyId: string,
  ): Promise<{ id: string; memberCount: number } | null>;
  countPatientsByFamilyId?(familyId: string): Promise<number>;
  findById(id: string): Promise<PatientDetail | null>;
  findByFamilyId(familyId: string): Promise<Patient[]>;
  findAll(): Promise<Patient[]>;
  update(id: string, data: UpdatePatientDto): Promise<Patient>;
  softDeactivate?(id: string): Promise<Patient>;
  findFamilyUnitByRepresentativeUserId(representativeUserId: string): Promise<FamilyUnit | null>;
  findFamilyUnitById(id: string): Promise<FamilyUnit | null>;
  addAllergy(patientId: string, data: CreateAllergyDto): Promise<PatientAllergy>;
  findAllergiesByPatientId(patientId: string): Promise<PatientAllergy[]>;
  findAllergyById?(allergyId: string): Promise<PatientAllergy | null>;
  deleteAllergy?(allergyId: string): Promise<PatientAllergy>;
  addDocument(patientId: string, data: CreatePatientDocumentDto): Promise<PatientDocument>;
  findDocumentsByPatientId(patientId: string): Promise<PatientDocument[]>;
  addVitalSign?(patientId: string, data: CreateVitalSignDto, isAbnormalAlert: boolean): Promise<VitalSign>;
  findVitalSignsByPatientId?(patientId: string, sinceDate: Date): Promise<VitalSign[]>;
  findVitalSignById?(vitalId: string): Promise<VitalSign | null>;
  updateVitalSign?(vitalId: string, data: UpdateVitalSignDto, isAbnormalAlert: boolean): Promise<VitalSign>;
  deleteVitalSign?(vitalId: string): Promise<VitalSign>;
}
