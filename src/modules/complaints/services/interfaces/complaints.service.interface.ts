import type { Complaint } from '@prisma/client';
import type { AuthenticatedUser } from '../../../../core/auth/authenticated-request';
import type {
  ListComplaintsQueryDto,
  ResolveComplaintDto,
  SubmitIncidentComplaintDto,
} from '../../dtos/complaint.dto';
import type { ComplaintListItem } from '../../repositories/interfaces/complaints.repository.interface';
export const COMPLAINTS_SERVICE_TOKEN = Symbol('IComplaintsService');
export interface IComplaintsService {
  listComplaints(
    actor: AuthenticatedUser,
    query: ListComplaintsQueryDto,
  ): Promise<{
    items: ComplaintListItem[];
    total: number;
    page: number;
    limit: number;
  }>;
  uploadComplaintEvidence(
    actor: AuthenticatedUser,
    file?: Express.Multer.File,
  ): Promise<{ evidenceKey: string }>;
  submitIncidentComplaint(
    actor: AuthenticatedUser,
    dto: SubmitIncidentComplaintDto,
  ): Promise<Complaint>;
  getComplaintDetail(
    actor: AuthenticatedUser,
    id: string,
  ): Promise<Record<string, unknown>>;
  resolveComplaint(
    actor: AuthenticatedUser,
    id: string,
    dto: ResolveComplaintDto,
  ): Promise<Complaint>;
}
