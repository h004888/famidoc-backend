import type { Complaint } from '@prisma/client';
import type { AuthenticatedUser } from '../../../../core/auth/authenticated-request';
import type {
  ResolveComplaintDto,
  SubmitIncidentComplaintDto,
} from '../../dtos/complaint.dto';
export const COMPLAINTS_SERVICE_TOKEN = Symbol('IComplaintsService');
export interface IComplaintsService {
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
