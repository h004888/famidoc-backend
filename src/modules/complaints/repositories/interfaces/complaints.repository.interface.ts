import { Prisma, type Complaint } from '@prisma/client';
export const COMPLAINT_CONTRACT_INCLUDE = {
  doctor: true,
  facility: true,
  familyUnit: true,
} as const;
export const COMPLAINT_INCLUDE = {
  contract: { include: COMPLAINT_CONTRACT_INCLUDE },
  complainantUser: { select: { id: true, fullName: true, role: true } },
} as const;
export const COMPLAINT_LIST_SELECT = {
  id: true,
  complaintCode: true,
  contractId: true,
  encounterId: true,
  complaintCategory: true,
  description: true,
  evidenceAttachments: true,
  status: true,
  facilityResponse: true,
  facilityReviewedAt: true,
  resolutionOutcome: true,
  resolutionNotes: true,
  resolvedAt: true,
  createdAt: true,
  updatedAt: true,
  complainantUser: { select: { id: true, fullName: true, role: true } },
  contract: {
    select: {
      contractNumber: true,
      facility: { select: { facilityName: true } },
      doctor: { select: { doctorName: true } },
    },
  },
} as const satisfies Prisma.ComplaintSelect;

export type ComplaintContract = Prisma.MedicalContractGetPayload<{
  include: typeof COMPLAINT_CONTRACT_INCLUDE;
}>;
export type ComplaintDetail = Prisma.ComplaintGetPayload<{
  include: typeof COMPLAINT_INCLUDE;
}>;
export type ComplaintListItem = Prisma.ComplaintGetPayload<{
  select: typeof COMPLAINT_LIST_SELECT;
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
  listComplaints(
    where: Prisma.ComplaintWhereInput,
    skip: number,
    take: number,
  ): Promise<{ items: ComplaintListItem[]; total: number }>;
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
