import { Prisma, type Complaint } from '@prisma/client';
export const COMPLAINT_CONTRACT_INCLUDE = {
  doctor: true,
  facility: true,
  familyUnit: true,
} as const;
export const COMPLAINT_INCLUDE = {
  contract: { include: COMPLAINT_CONTRACT_INCLUDE },
} as const;
export type ComplaintContract = Prisma.MedicalContractGetPayload<{
  include: typeof COMPLAINT_CONTRACT_INCLUDE;
}>;
export type ComplaintDetail = Prisma.ComplaintGetPayload<{
  include: typeof COMPLAINT_INCLUDE;
}>;
export const COMPLAINTS_REPOSITORY_TOKEN = Symbol('IComplaintsRepository');
export interface ComplaintsSession {
  findContract(id: string): Promise<ComplaintContract | null>;
  encounterBelongsToContract(
    encounterId: string,
    contractId: string,
  ): Promise<boolean>;
  createComplaint(
    data: Prisma.ComplaintUncheckedCreateInput,
  ): Promise<Complaint>;
  findComplaint(id: string): Promise<ComplaintDetail | null>;
  updateComplaint(
    id: string,
    data: Prisma.ComplaintUncheckedUpdateInput,
  ): Promise<Complaint>;
  recordComplaintEvent(
    actorId: string,
    complaintId: string,
    action: string,
    contract: ComplaintContract,
  ): Promise<void>;
}
export interface IComplaintsRepository {
  transaction<T>(work: (session: ComplaintsSession) => Promise<T>): Promise<T>;
}
