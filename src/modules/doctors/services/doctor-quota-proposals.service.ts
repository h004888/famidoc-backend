import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import type { AuthenticatedUser } from '../../../core/auth/authenticated-request';
import {
  buildActiveAndHeldWhere,
  countActiveAndHeldMap,
} from '../../contracts/pricing/doctor-quota.helper';
import type {
  CreateDoctorQuotaProposalDto,
  ListQuotaProposalsQueryDto,
  ReviewDoctorQuotaProposalDto,
} from '../dtos/quota-proposal.dto';

@Injectable()
export class DoctorQuotaProposalsService {
  constructor(private readonly prisma: PrismaService) {}

  async createProposal(
    actor: AuthenticatedUser,
    doctorId: string,
    dto: CreateDoctorQuotaProposalDto,
    ip: string,
  ) {
    if (actor.role !== 'HEALTHCARE_FACILITY') {
      throw new ForbiddenException(
        'Chỉ Cơ sở y tế mới có quyền đề xuất điều chỉnh quota bác sĩ',
      );
    }

    const facility = await this.prisma.healthcareFacility.findUnique({
      where: { userId: actor.id },
    });
    if (!facility || facility.verificationStatus !== 'ACTIVE') {
      throw new ForbiddenException(
        'Cơ sở y tế chưa được kích hoạt hoặc không tồn tại',
      );
    }

    const doctor = await this.prisma.doctor.findUnique({
      where: { id: doctorId },
    });
    if (!doctor || doctor.facilityId !== facility.id) {
      throw new NotFoundException(
        'Không tìm thấy bác sĩ trực thuộc cơ sở y tế của bạn',
      );
    }

    if (dto.requestedMaxPanel === doctor.maxPanelCapacity) {
      throw new BadRequestException(
        'Hạn mức đề xuất phải khác hạn mức hiện tại của bác sĩ',
      );
    }

    const countMap = await countActiveAndHeldMap(this.prisma, [doctor.id]);
    const activeAndHeldCount = countMap.get(doctor.id) ?? 0;

    if (dto.requestedMaxPanel < activeAndHeldCount) {
      throw new ConflictException(
        `Hạn mức đề xuất (${dto.requestedMaxPanel}) không được thấp hơn số hộ gia đình đang giữ chỗ/hoạt động (${activeAndHeldCount})`,
      );
    }

    const existingPending = await this.prisma.doctorQuotaProposal.findFirst({
      where: { doctorId: doctor.id, status: 'PENDING' },
      select: { id: true },
    });
    if (existingPending) {
      throw new ConflictException(
        'Bác sĩ đang có một đề xuất điều chỉnh quota chờ Quản trị viên duyệt',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const proposal = await tx.doctorQuotaProposal.create({
        data: {
          doctorId: doctor.id,
          facilityId: facility.id,
          requestedByUserId: actor.id,
          currentMaxPanel: doctor.maxPanelCapacity,
          requestedMaxPanel: dto.requestedMaxPanel,
          reason: dto.reason.trim(),
          status: 'PENDING',
        },
        include: {
          doctor: {
            select: {
              id: true,
              doctorName: true,
              specialty: true,
              clinicalTier: true,
              maxPanelCapacity: true,
              activePanelCount: true,
            },
          },
          facility: {
            select: {
              id: true,
              facilityName: true,
            },
          },
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: actor.id,
          action: 'DOCTOR_QUOTA_PROPOSAL_CREATED',
          resourceName: 'DoctorQuotaProposal',
          resourceId: proposal.id,
          clientIp: ip || '127.0.0.1',
          timestamp: new Date(),
        },
      });

      const admins = await tx.user.findMany({
        where: { role: 'ADMIN', status: 'ACTIVE' },
        select: { id: true },
      });
      if (admins.length > 0) {
        await tx.notification.createMany({
          data: admins.map((admin) => ({
            userId: admin.id,
            title: 'Đề xuất điều chỉnh Quota bác sĩ mới',
            content: `${facility.facilityName} đề xuất điều chỉnh hạn mức hộ gia đình của ${doctor.doctorName} từ ${doctor.maxPanelCapacity} lên ${dto.requestedMaxPanel}.`,
            type: 'DOCTOR_QUOTA_PROPOSAL',
            referenceId: proposal.id,
          })),
        });
      }

      return {
        ...proposal,
        activeAndHeldCount,
      };
    });
  }

  async listDoctorProposalsForFacility(
    actor: AuthenticatedUser,
    doctorId: string,
  ) {
    if (actor.role !== 'HEALTHCARE_FACILITY') {
      throw new ForbiddenException(
        'Chỉ Cơ sở y tế mới có quyền xem đề xuất quota của bác sĩ đơn vị mình',
      );
    }

    const facility = await this.prisma.healthcareFacility.findUnique({
      where: { userId: actor.id },
      select: { id: true },
    });
    if (!facility) {
      throw new ForbiddenException('Không tìm thấy cơ sở y tế');
    }

    const doctor = await this.prisma.doctor.findUnique({
      where: { id: doctorId },
      select: { id: true, facilityId: true },
    });
    if (!doctor || doctor.facilityId !== facility.id) {
      throw new NotFoundException(
        'Không tìm thấy bác sĩ trực thuộc cơ sở y tế của bạn',
      );
    }

    const items = await this.prisma.doctorQuotaProposal.findMany({
      where: { doctorId, facilityId: facility.id },
      orderBy: { createdAt: 'desc' },
      include: {
        doctor: {
          select: {
            id: true,
            doctorName: true,
            specialty: true,
            clinicalTier: true,
            maxPanelCapacity: true,
          },
        },
      },
    });

    return { items, total: items.length };
  }

  async listFacilityProposals(
    actor: AuthenticatedUser,
    query: ListQuotaProposalsQueryDto,
  ) {
    if (actor.role !== 'HEALTHCARE_FACILITY') {
      throw new ForbiddenException(
        'Chỉ Cơ sở y tế mới có quyền xem danh sách đề xuất quota',
      );
    }

    const facility = await this.prisma.healthcareFacility.findUnique({
      where: { userId: actor.id },
      select: { id: true },
    });
    if (!facility) {
      throw new ForbiddenException('Không tìm thấy cơ sở y tế');
    }

    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));
    const where = {
      facilityId: facility.id,
      ...(query.status ? { status: query.status } : {}),
    };

    const [total, items] = await Promise.all([
      this.prisma.doctorQuotaProposal.count({ where }),
      this.prisma.doctorQuotaProposal.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          doctor: {
            select: {
              id: true,
              doctorName: true,
              specialty: true,
              clinicalTier: true,
              maxPanelCapacity: true,
            },
          },
        },
      }),
    ]);

    return { items, total, page, limit };
  }

  async listAdminProposals(
    actor: AuthenticatedUser,
    query: ListQuotaProposalsQueryDto,
  ) {
    if (actor.role !== 'ADMIN') {
      throw new ForbiddenException(
        'Chỉ Quản trị viên mới có quyền xem toàn bộ đề xuất điều chỉnh quota',
      );
    }

    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));
    const where = query.status ? { status: query.status } : {};

    const [total, items] = await Promise.all([
      this.prisma.doctorQuotaProposal.count({ where }),
      this.prisma.doctorQuotaProposal.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          doctor: {
            select: {
              id: true,
              doctorName: true,
              specialty: true,
              clinicalTier: true,
              maxPanelCapacity: true,
              activePanelCount: true,
            },
          },
          facility: {
            select: {
              id: true,
              facilityName: true,
            },
          },
        },
      }),
    ]);

    const doctorIds = Array.from(new Set(items.map((item) => item.doctorId)));
    const countMap = await countActiveAndHeldMap(this.prisma, doctorIds);

    return {
      items: items.map((item) => ({
        ...item,
        activeAndHeldCount: countMap.get(item.doctorId) ?? 0,
      })),
      total,
      page,
      limit,
    };
  }

  async reviewProposal(
    actor: AuthenticatedUser,
    proposalId: string,
    dto: ReviewDoctorQuotaProposalDto,
    ip: string,
  ) {
    if (actor.role !== 'ADMIN') {
      throw new ForbiddenException(
        'Chỉ Quản trị viên mới có quyền phê duyệt hoặc từ chối đề xuất quota',
      );
    }

    if (dto.action === 'REJECT' && !dto.reviewNote?.trim()) {
      throw new BadRequestException(
        'Vui lòng nhập lý do từ chối đề xuất điều chỉnh quota',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const proposal = await tx.doctorQuotaProposal.findUnique({
        where: { id: proposalId },
        include: {
          doctor: {
            select: {
              id: true,
              doctorName: true,
              maxPanelCapacity: true,
            },
          },
          facility: {
            select: {
              id: true,
              facilityName: true,
              userId: true,
            },
          },
        },
      });

      if (!proposal) {
        throw new NotFoundException('Không tìm thấy đề xuất điều chỉnh quota');
      }

      if (proposal.status !== 'PENDING') {
        throw new ConflictException(
          'Đề xuất điều chỉnh quota đã được xử lý trước đó',
        );
      }

      const now = new Date();
      let activeAndHeldCount = 0;

      if (dto.action === 'APPROVE') {
        await tx.$queryRaw`SELECT id FROM doctors WHERE id=${proposal.doctorId}::uuid FOR UPDATE`;
        activeAndHeldCount = await tx.medicalContract.count({
          where: buildActiveAndHeldWhere(proposal.doctorId, { now }),
        });

        if (proposal.requestedMaxPanel < activeAndHeldCount) {
          throw new ConflictException(
            `Không thể phê duyệt hạn mức ${proposal.requestedMaxPanel} vì bác sĩ đang phụ trách/giữ chỗ ${activeAndHeldCount} hộ gia đình`,
          );
        }

        await tx.doctor.update({
          where: { id: proposal.doctorId },
          data: { maxPanelCapacity: proposal.requestedMaxPanel },
        });
      }

      const nextStatus = dto.action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
      const updated = await tx.doctorQuotaProposal.update({
        where: { id: proposal.id },
        data: {
          status: nextStatus,
          reviewedByUserId: actor.id,
          reviewedAt: now,
          reviewNote: dto.reviewNote?.trim() || null,
        },
        include: {
          doctor: {
            select: {
              id: true,
              doctorName: true,
              specialty: true,
              clinicalTier: true,
              maxPanelCapacity: true,
            },
          },
          facility: {
            select: {
              id: true,
              facilityName: true,
            },
          },
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: actor.id,
          action:
            dto.action === 'APPROVE'
              ? 'APPROVE_DOCTOR_QUOTA_PROPOSAL'
              : 'REJECT_DOCTOR_QUOTA_PROPOSAL',
          resourceName: 'DoctorQuotaProposal',
          resourceId: proposal.id,
          clientIp: ip || '127.0.0.1',
          timestamp: now,
        },
      });

      const recipientIds = Array.from(
        new Set(
          [proposal.requestedByUserId, proposal.facility?.userId].filter(
            Boolean,
          ),
        ),
      ) as string[];

      if (recipientIds.length > 0) {
        const title =
          dto.action === 'APPROVE'
            ? 'Đề xuất điều chỉnh Quota bác sĩ đã được duyệt'
            : 'Đề xuất điều chỉnh Quota bác sĩ bị từ chối';
        const content =
          dto.action === 'APPROVE'
            ? `Hạn mức hộ gia đình của ${proposal.doctor.doctorName} đã được cập nhật từ ${proposal.currentMaxPanel} lên ${proposal.requestedMaxPanel}.`
            : `Đề xuất điều chỉnh hạn mức của ${proposal.doctor.doctorName} lên ${proposal.requestedMaxPanel} đã bị từ chối. Lý do: ${dto.reviewNote?.trim()}`;

        await tx.notification.createMany({
          data: recipientIds.map((userId) => ({
            userId,
            title,
            content,
            type:
              dto.action === 'APPROVE'
                ? 'DOCTOR_QUOTA_PROPOSAL_APPROVED'
                : 'DOCTOR_QUOTA_PROPOSAL_REJECTED',
            referenceId: proposal.id,
          })),
        });
      }

      return {
        ...updated,
        activeAndHeldCount,
      };
    });
  }
}
