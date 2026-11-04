import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { getContractSignerRole } from '../../../../core/business/business-helpers';
import type { AuthenticatedUser } from '../../../../core/auth/authenticated-request';
import {
  COMPLAINTS_REPOSITORY_TOKEN,
  type IComplaintsRepository,
  type ComplaintDetail,
} from '../../repositories/interfaces/complaints.repository.interface';
import type { IComplaintsService } from '../interfaces/complaints.service.interface';
import type {
  ResolveComplaintDto,
  SubmitIncidentComplaintDto,
} from '../../dtos/complaint.dto';
@Injectable()
export class ComplaintsServiceImpl implements IComplaintsService {
  constructor(
    @Inject(COMPLAINTS_REPOSITORY_TOKEN)
    private readonly repository: IComplaintsRepository,
  ) {}
  submitIncidentComplaint(
    actor: AuthenticatedUser,
    dto: SubmitIncidentComplaintDto,
  ) {
    if (!['FAMILY_REP', 'DOCTOR'].includes(actor.role))
      throw new ForbiddenException(
        'Only families and assigned doctors can file incidents',
      );
    return this.repository.transaction(async (session) => {
      const contract = await session.findContract(dto.contractId);
      if (!contract) throw new NotFoundException('Contract not found');
      getContractSignerRole(contract, actor);
      if (
        dto.encounterId &&
        !(await session.encounterBelongsToContract(
          dto.encounterId,
          contract.id,
        ))
      )
        throw new BadRequestException(
          'Encounter does not belong to this contract',
        );
      // Bằng chứng chỉ tham chiếu object đã tải trong vùng của người gửi, không nhận link tùy ý.
      const keys = dto.evidenceKeys ?? [];
      if (
        keys.some(
          (key) =>
            !key.startsWith(`${actor.id}/complaints/`) ||
            key.includes('..') ||
            key.includes('://'),
        )
      )
        throw new BadRequestException(
          'Evidence keys must be in your complaint upload namespace',
        );
      const targetUserId =
        actor.role === 'DOCTOR'
          ? contract.familyUnit.representativeUserId
          : contract.doctor.userId;
      const item = await session.createComplaint({
        complaintCode: 'CP' + randomUUID().replaceAll('-', '').toUpperCase(),
        contractId: contract.id,
        encounterId: dto.encounterId,
        complainantUserId: actor.id,
        targetUserId,
        complaintCategory: dto.category,
        description: dto.description,
        evidenceAttachments: keys,
      });
      await session.recordComplaintEvent(
        actor.id,
        item.id,
        'SUBMIT_INCIDENT_COMPLAINT',
        contract,
      );
      return item;
    });
  }
  getComplaintDetail(actor: AuthenticatedUser, id: string) {
    return this.repository.transaction(async (session) => {
      const item = await session.findComplaint(id);
      this.assertComplaintAccess(item, actor);
      if (!item) throw new NotFoundException('Complaint not found');
      // Không trả đối tượng contract include: nó chứa thông tin nội bộ của CSYT/bác sĩ.
      const { contract, ...detail } = item;
      return {
        ...detail,
        facilityId: contract.facilityId,
        doctorId: contract.doctorId,
      };
    });
  }
  resolveComplaint(
    actor: AuthenticatedUser,
    id: string,
    dto: ResolveComplaintDto,
  ) {
    return this.repository.transaction(async (session) => {
      const item = await session.findComplaint(id);
      this.assertComplaintAccess(item, actor);
      if (!item) throw new NotFoundException('Complaint not found');
      if (!['ADMIN', 'HEALTHCARE_FACILITY'].includes(actor.role))
        throw new ForbiddenException(
          'Only Admin and the responsible facility can process complaints',
        );
      if (
        item.status === 'CLOSED' ||
        (item.status === 'RESOLVED' && dto.action !== 'CLOSE')
      )
        throw new ConflictException('Complaint has already been resolved');
      if (dto.action === 'FACILITY_RESPONSE') {
        if (actor.role !== 'HEALTHCARE_FACILITY')
          throw new ForbiddenException(
            'The facility must submit its own verification',
          );
        if (item.status !== 'INVESTIGATING')
          throw new ConflictException(
            'Admin must start the investigation first',
          );
        if (item.facilityReviewedAt)
          throw new ConflictException(
            'Facility verification has already been recorded',
          );
        const updated = await session.updateComplaint(id, {
          facilityResponse: dto.notes,
          facilityReviewedById: actor.id,
          facilityReviewedAt: new Date(),
        });
        await session.recordComplaintEvent(
          actor.id,
          id,
          'COMPLAINT_FACILITY_RESPONSE',
          item.contract,
        );
        return updated;
      }
      if (actor.role !== 'ADMIN')
        throw new ForbiddenException('Only Admin can issue the final decision');
      if (dto.action === 'INVESTIGATE') {
        if (item.status !== 'SUBMITTED')
          throw new ConflictException(
            'Complaint is not awaiting investigation',
          );
        const updated = await session.updateComplaint(id, {
          status: 'INVESTIGATING',
        });
        await session.recordComplaintEvent(
          actor.id,
          id,
          'INVESTIGATE_COMPLAINT',
          item.contract,
        );
        return updated;
      }
      if (dto.action === 'RESOLVE') {
        // CSYT xác minh phần chuyên môn trước, Admin mới chốt kết luận phi tài chính.
        if (item.status !== 'INVESTIGATING' || !item.facilityReviewedAt)
          throw new ConflictException(
            'Facility verification is required before resolution',
          );
        const updated = await session.updateComplaint(id, {
          status: 'RESOLVED',
          resolutionOutcome: dto.outcome,
          resolutionNotes: dto.notes,
          resolvedAt: new Date(),
          resolvedByUserId: actor.id,
        });
        await session.recordComplaintEvent(
          actor.id,
          id,
          'RESOLVE_COMPLAINT',
          item.contract,
        );
        return updated;
      }
      if (item.status !== 'RESOLVED')
        throw new ConflictException('Resolve the complaint before closing it');
      const updated = await session.updateComplaint(id, { status: 'CLOSED' });
      await session.recordComplaintEvent(
        actor.id,
        id,
        'CLOSE_COMPLAINT',
        item.contract,
      );
      return updated;
    });
  }
  private assertComplaintAccess(
    item: ComplaintDetail | null,
    actor: AuthenticatedUser,
  ) {
    if (!item) throw new NotFoundException('Complaint not found');
    try {
      getContractSignerRole(item.contract, actor);
    } catch {
      throw new NotFoundException('Complaint not found');
    }
  }
}
