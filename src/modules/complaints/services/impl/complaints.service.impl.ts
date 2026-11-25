import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { getContractSignerRole } from '../../../../core/business/business-helpers';
import type { AuthenticatedUser } from '../../../../core/auth/authenticated-request';
import { StorageService } from '../../../../core/services/storage.service';
import {
  COMPLAINTS_REPOSITORY_TOKEN,
  type IComplaintsRepository,
  type ComplaintDetail,
} from '../../repositories/interfaces/complaints.repository.interface';
import type { IComplaintsService } from '../interfaces/complaints.service.interface';
import type {
  ListComplaintsQueryDto,
  ResolveComplaintDto,
  SubmitIncidentComplaintDto,
} from '../../dtos/complaint.dto';

function resolveEvidenceExtension(file: Express.Multer.File): string {
  const mime = (file.mimetype || '').toLowerCase();
  const name = (file.originalname || '').toLowerCase();
  if (mime === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (mime === 'image/png' || name.endsWith('.png')) return 'png';
  if (
    mime === 'image/jpeg' ||
    mime === 'image/jpg' ||
    name.endsWith('.jpg') ||
    name.endsWith('.jpeg')
  ) {
    return 'jpg';
  }
  throw new BadRequestException(
    'Chỉ chấp nhận tệp bằng chứng định dạng PDF, PNG hoặc JPEG.',
  );
}

@Injectable()
export class ComplaintsServiceImpl implements IComplaintsService {
  constructor(
    @Inject(COMPLAINTS_REPOSITORY_TOKEN)
    private readonly repository: IComplaintsRepository,
    private readonly storage: StorageService,
  ) {}

  listComplaints(actor: AuthenticatedUser, query: ListComplaintsQueryDto) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(50, Math.max(1, query.limit ?? 20));
    const skip = (page - 1) * limit;
    const where: Prisma.ComplaintWhereInput = query.status
      ? { status: query.status }
      : {};

    if (actor.role === 'FAMILY_REP') {
      where.contract = { familyUnit: { representativeUserId: actor.id } };
    } else if (actor.role === 'DOCTOR') {
      where.contract = { doctor: { userId: actor.id } };
    } else if (actor.role === 'HEALTHCARE_FACILITY') {
      where.contract = { facility: { userId: actor.id } };
    } else if (actor.role !== 'ADMIN') {
      throw new ForbiddenException('Bạn không có quyền xem danh sách khiếu nại.');
    }

    return this.repository.transaction(async (session) => {
      const { items, total } = await session.listComplaints(where, skip, limit);
      return { items, total, page, limit };
    });
  }

  async uploadComplaintEvidence(
    actor: AuthenticatedUser,
    file?: Express.Multer.File,
  ) {
    if (!['FAMILY_REP', 'DOCTOR'].includes(actor.role)) {
      throw new ForbiddenException(
        'Chỉ đại diện hộ gia đình hoặc bác sĩ mới được tải bằng chứng khiếu nại.',
      );
    }
    if (!file?.buffer?.length || file.buffer.length > 5 * 1024 * 1024) {
      throw new BadRequestException(
        'Tệp bằng chứng phải có dung lượng từ 1 byte đến 5 MB.',
      );
    }
    const extension = resolveEvidenceExtension(file);
    try {
      const evidenceKey = await this.storage.uploadFile(
        { ...file, originalname: `bang-chung.${extension}` },
        `${actor.id}/complaints`,
      );
      return { evidenceKey };
    } catch {
      throw new ServiceUnavailableException(
        'Không tải được tệp bằng chứng lên kho lưu trữ. Vui lòng thử lại.',
      );
    }
  }

  submitIncidentComplaint(
    actor: AuthenticatedUser,
    dto: SubmitIncidentComplaintDto,
  ) {
    if (!['FAMILY_REP', 'DOCTOR'].includes(actor.role))
      throw new ForbiddenException(
        'Chỉ đại diện hộ gia đình hoặc bác sĩ phụ trách mới có thể gửi khiếu nại.',
      );
    return this.repository.transaction(async (session) => {
      const contract = await session.findContract(dto.contractId);
      if (!contract) throw new NotFoundException('Không tìm thấy hợp đồng.');
      getContractSignerRole(contract, actor);
      if (
        dto.encounterId &&
        !(await session.encounterBelongsToContract(
          dto.encounterId,
          contract.id,
        ))
      )
        throw new BadRequestException(
          'Lượt khám không thuộc hợp đồng đã chọn.',
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
          'Đường dẫn tệp bằng chứng không thuộc vùng tải lên hợp lệ của bạn.',
        );
      if (!contract.doctor) {
        throw new BadRequestException('Hợp đồng chưa có bác sĩ phân công.');
      }
      const evidenceExists = await Promise.all(
        keys.map((key) => this.storage.objectExists(key)),
      );
      if (evidenceExists.includes(false))
        throw new BadRequestException('Có tệp bằng chứng chưa được tải lên.');
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
      if (
        actor.role === 'FAMILY_REP' &&
        dto.category === 'DOCTOR_ABSENT' &&
        dto.encounterId
      ) {
        await session.markEncounterDisputed(dto.encounterId);
      }
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
      if (!item) throw new NotFoundException('Không tìm thấy khiếu nại.');
      // Chỉ trả các trường hiển thị công khai của hợp đồng, không trả nguyên đối tượng contract nội bộ.
      const { contract, ...detail } = item;
      return {
        ...detail,
        facilityId: contract.facilityId,
        doctorId: contract.doctorId,
        contract: {
          contractNumber: contract.contractNumber,
          facility: { facilityName: contract.facility.facilityName },
          doctor: contract.doctor
            ? { doctorName: contract.doctor.doctorName }
            : null,
        },
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
      if (!item) throw new NotFoundException('Không tìm thấy khiếu nại.');
      if (!['ADMIN', 'HEALTHCARE_FACILITY'].includes(actor.role))
        throw new ForbiddenException(
          'Chỉ Quản trị viên và Cơ sở y tế phụ trách mới có quyền xử lý khiếu nại.',
        );
      if (
        item.status === 'CLOSED' ||
        (item.status === 'RESOLVED' && dto.action !== 'CLOSE')
      )
        throw new ConflictException('Khiếu nại này đã được giải quyết trước đó.');
      if (dto.action === 'FACILITY_RESPONSE') {
        if (actor.role !== 'HEALTHCARE_FACILITY')
          throw new ForbiddenException(
            'Chỉ Cơ sở y tế phụ trách mới được gửi biên bản xác minh.',
          );
        if (item.status !== 'INVESTIGATING')
          throw new ConflictException(
            'Quản trị viên cần thụ lý hồ sơ trước khi Cơ sở y tế gửi xác minh.',
          );
        if (item.facilityReviewedAt)
          throw new ConflictException(
            'Cơ sở y tế đã gửi biên bản xác minh trước đó.',
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
        throw new ForbiddenException(
          'Chỉ Quản trị viên mới có quyền ban hành quyết định cuối cùng.',
        );
      if (dto.action === 'INVESTIGATE') {
        if (item.status !== 'SUBMITTED')
          throw new ConflictException(
            'Khiếu nại không ở trạng thái chờ thụ lý.',
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
            'Cần có biên bản xác minh từ Cơ sở y tế trước khi ra phán quyết.',
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
        throw new ConflictException(
          'Cần ban hành phán quyết trước khi đóng hồ sơ khiếu nại.',
        );
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
    if (!item) throw new NotFoundException('Không tìm thấy khiếu nại.');
    try {
      getContractSignerRole(item.contract, actor);
    } catch {
      throw new NotFoundException('Không tìm thấy khiếu nại.');
    }
  }
}
