import { Encounter, EncounterRescheduleRequest, EncounterStatus, EncounterType, Prisma } from '@prisma/client';

export const ENCOUNTER_INCLUDE = {
  contract: {
    include: {
      familyUnit: {
        include: { representativeUser: true },
      },
      facility: {
        include: { user: true },
      },
      doctor: {
        include: { user: true },
      },
      members: {
        include: { patient: true },
      },
      servicePackage: true,
    },
  },
  participants: {
    include: { patient: true },
  },
  rescheduleRequests: {
    orderBy: { createdAt: 'desc' },
    take: 5,
  },
  clinicalEmrs: {
    select: {
      id: true,
      patientId: true,
      isFinalized: true,
    },
  },
  doctor: {
    include: {
      user: true,
      facility: true,
    },
  },
  telehealthSession: true,
} as const;

export type EncounterDetail = Prisma.EncounterGetPayload<{
  include: typeof ENCOUNTER_INCLUDE;
}>;

export const ENCOUNTERS_REPOSITORY_TOKEN = Symbol('IEncountersRepository');

export interface EncountersSession {
  findContract(id: string): Promise<Prisma.MedicalContractGetPayload<{
    include: {
      familyUnit: { include: { representativeUser: true } };
      facility: { include: { user: true } };
      doctor: { include: { user: true } };
      members: { include: { patient: true } };
      servicePackage: true;
    };
  }> | null>;

  isPatientInContract(patientId: string, contractId: string): Promise<boolean>;
  findDoctorByUserId(userId: string): Promise<Prisma.DoctorGetPayload<{ include: { facility: true } }> | null>;
  findDoctorById(id: string): Promise<Prisma.DoctorGetPayload<{ include: { facility: true } }> | null>;
  findFacilityByUserId(userId: string): Promise<Prisma.HealthcareFacilityGetPayload<Record<string, never>> | null>;

  createEncounter(data: Prisma.EncounterUncheckedCreateInput): Promise<Encounter>;
  findEncounter(id: string): Promise<EncounterDetail | null>;
  updateEncounter(id: string, data: Prisma.EncounterUncheckedUpdateInput): Promise<Encounter>;
  decrementContractQuota(contractId: string, type: EncounterType): Promise<void>;

  findDoctorOverlappingEncounters(
    doctorId: string,
    scheduledDate: Date,
    excludeEncounterId?: string,
    statuses?: EncounterStatus[],
  ): Promise<Encounter[]>;

  findPendingRescheduleRequestByEncounter(encounterId: string): Promise<EncounterRescheduleRequest | null>;
  findRescheduleRequestById(requestId: string): Promise<EncounterRescheduleRequest | null>;
  createRescheduleRequest(
    data: Prisma.EncounterRescheduleRequestUncheckedCreateInput,
  ): Promise<EncounterRescheduleRequest>;
  updateRescheduleRequest(
    id: string,
    data: Prisma.EncounterRescheduleRequestUncheckedUpdateInput,
  ): Promise<EncounterRescheduleRequest>;
  findPendingRescheduleRequests(
    where: Prisma.EncounterRescheduleRequestWhereInput,
  ): Promise<EncounterRescheduleRequest[]>;

  findEncounters(
    where: Prisma.EncounterWhereInput,
    skip?: number,
    take?: number,
  ): Promise<[EncounterDetail[], number]>;

  createNotification(data: Prisma.NotificationUncheckedCreateInput): Promise<void>;
  createNotifications(data: Prisma.NotificationUncheckedCreateInput[]): Promise<void>;
  createAuditLog(actorId: string, action: string, resourceId: string): Promise<void>;
}

export interface IEncountersRepository {
  transaction<T>(work: (session: EncountersSession) => Promise<T>): Promise<T>;
}
