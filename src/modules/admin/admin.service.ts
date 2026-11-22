import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { buildActiveAndHeldWhere } from '../contracts/pricing/doctor-quota.helper';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { moneyToNumber, serializable } from '../../core/database/prisma-transaction';
import type { AuthenticatedUser } from '../../core/auth/authenticated-request';
import { AUTH_SERVICE_TOKEN, type IAuthService } from '../auth/services/interfaces/auth.service.interface';
import type { AdminAccountStatusDto, AdminAuditQuery, AdminComplaintsQuery, AdminOverviewQuery, AdminUsersQuery } from './admin.dto';

const userFields = { id: true, fullName: true, email: true, phone: true, role: true, status: true, createdAt: true } as const;
const accountActions = ['ADMIN_SUSPEND_USER', 'ADMIN_RESTORE_USER'];
const complaintFields = {
  id: true,
  complaintCode: true,
  contractId: true,
  complaintCategory: true,
  description: true,
  status: true,
  createdAt: true,
  facilityReviewedAt: true,
  complainantUser: { select: { fullName: true } },
  contract: { select: { contractNumber: true, facility: { select: { facilityName: true } } } },
} satisfies Prisma.ComplaintSelect;

function windowInVietnam(period: AdminOverviewQuery['period']) {
  const now = new Date(Date.now() + 7 * 3600_000);
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const day = now.getUTCDate();
  if (period === 'weekly') {
    const monday = day - (now.getUTCDay() + 6) % 7;
    return {
      start: new Date(Date.UTC(year, month, monday)),
      end: new Date(Date.UTC(year, month, monday + 7)),
      days: Array.from({ length: 7 }, (_, i) => new Date(Date.UTC(year, month, monday + i))),
    };
  }
  if (period === 'yearly') {
    return {
      start: new Date(Date.UTC(year, 0, 1)),
      end: new Date(Date.UTC(year + 1, 0, 1)),
      days: Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(year, i, 1))),
    };
  }
  return {
    start: new Date(Date.UTC(year, month, 1)),
    end: new Date(Date.UTC(year, month + 1, 1)),
    days: Array.from({ length: new Date(Date.UTC(year, month + 1, 0)).getUTCDate() }, (_, i) => new Date(Date.UTC(year, month, i + 1))),
  };
}

@Injectable()
export class AdminService {
  constructor(
    private readonly db: PrismaService,
    @Inject(AUTH_SERVICE_TOKEN) private readonly auth: IAuthService,
  ) {}

  async resendFacilityInvite(actor: AuthenticatedUser, id: string, ip?: string) {
    if (actor.role !== 'ADMIN') throw new ForbiddenException('Chỉ Admin được gửi lại mã thiết lập mật khẩu.');
    const facility = await this.db.healthcareFacility.findUnique({ where: { id }, select: {
      verificationStatus: true, user: { select: { status: true, email: true } },
    } });
    if (!facility) throw new NotFoundException('Không tìm thấy cơ sở y tế.');
    if (facility.user.status !== 'ACTIVE' || facility.verificationStatus !== 'PENDING')
      throw new ConflictException('Chỉ gửi lại mã cho CSYT đã được cấp tài khoản và đang hoàn thiện hồ sơ.');
    await this.auth.requestForgotPassword({ email: facility.user.email });
    await this.db.auditLog.create({ data: {
      actorUserId: actor.id, action: 'FACILITY_INVITE_RESENT', resourceName: 'HealthcareFacility',
      resourceId: id, clientIp: ip?.slice(0, 45) ?? 'unknown',
    } });
    return { message: 'Đã gửi mã thiết lập lại mật khẩu qua email.' };
  }

  async listUsers(query: AdminUsersQuery) {
    const { q, role, page, limit } = query;
    const where: Prisma.UserWhereInput = {
      role,
      ...(q ? { OR: [
        { fullName: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q } },
      ] } : {}),
    };
    const [users, total] = await Promise.all([
      this.db.user.findMany({ where, select: {
        ...userFields,
        healthcareFacility: { select: { verificationStatus: true } },
        doctor: { select: { onboardingStatus: true } },
      }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: (page - 1) * limit, take: limit }),
      this.db.user.count({ where }),
    ]);
    const suspended = users.filter((user) => user.status === 'SUSPENDED').map((user) => user.id);
    const events = suspended.length ? await this.db.auditLog.findMany({
      where: { resourceName: 'users', resourceId: { in: suspended }, action: { in: accountActions } },
      orderBy: { id: 'desc' },
      distinct: ['resourceId'],
      select: { resourceId: true, action: true },
    }) : [];
    const eligible = new Set(events.filter((event) => event.action === accountActions[0]).map((event) => event.resourceId));
    return {
      items: users.map(({ healthcareFacility, doctor, ...user }) => ({
        ...user,
        canRestore: user.role !== 'ADMIN' && eligible.has(user.id) &&
          healthcareFacility?.verificationStatus !== 'SUSPENDED' && doctor?.onboardingStatus !== 'SUSPENDED',
      })),
      total, page, limit,
    };
  }

  async changeStatus(actor: AuthenticatedUser, id: string, dto: AdminAccountStatusDto, ip?: string) {
    if (actor.role !== 'ADMIN' || id === actor.id) throw new ForbiddenException('Tài khoản này không thể thay đổi trạng thái tại đây.');
    return serializable(this.db, async (tx) => {
      const user = await tx.user.findUnique({
        where: { id },
        select: {
          ...userFields,
          healthcareFacility: { select: { verificationStatus: true } },
          doctor: { select: { onboardingStatus: true } },
        },
      });
      if (!user) throw new NotFoundException('Không tìm thấy tài khoản.');
      if (user.role === 'ADMIN') throw new ForbiddenException('Tài khoản Admin không thể thay đổi trạng thái tại đây.');
      const expected = dto.status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED';
      if (user.status !== expected) throw new ConflictException('Trạng thái tài khoản đã thay đổi. Hãy tải lại danh sách.');
      if (dto.status === 'ACTIVE') {
        const lastAction = await tx.auditLog.findFirst({
          where: { resourceName: 'users', resourceId: id, action: { in: accountActions } },
          orderBy: { id: 'desc' },
        });
        if (lastAction?.action !== accountActions[0] ||
            user.healthcareFacility?.verificationStatus === 'SUSPENDED' ||
            user.doctor?.onboardingStatus === 'SUSPENDED') {
          throw new ConflictException('Tài khoản cần được xử lý qua quy trình thẩm định tương ứng.');
        }
      }
      const updated = await tx.user.update({ where: { id }, data: { status: dto.status }, select: userFields });
      await tx.auditLog.create({ data: {
        actorUserId: actor.id, resourceName: 'users', resourceId: id, clientIp: ip?.slice(0, 45) ?? 'unknown',
        action: dto.status === 'SUSPENDED' ? accountActions[0] : accountActions[1],
        details: { previousStatus: user.status, status: dto.status, reason: dto.reason },
      } });
      return updated;
    });
  }

  async auditLogs({ resourceName, resourceId, action, q, page, limit }: AdminAuditQuery) {
    const where: Prisma.AuditLogWhereInput = {
      ...(resourceName ? { resourceName } : {}),
      ...(resourceId ? { resourceId } : {}),
      ...(action ? { action } : {}),
      ...(q
        ? {
            OR: [
              { action: { contains: q, mode: 'insensitive' } },
              { resourceName: { contains: q, mode: 'insensitive' } },
              { resourceId: { contains: q, mode: 'insensitive' } },
              { clientIp: { contains: q } },
              { actorUser: { fullName: { contains: q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [records, total] = await Promise.all([
      this.db.auditLog.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          timestamp: true,
          action: true,
          resourceName: true,
          resourceId: true,
          clientIp: true,
          details: true,
          actorUser: { select: { fullName: true, role: true } },
        },
      }),
      this.db.auditLog.count({ where }),
    ]);
    return { items: records.map((record) => ({ ...record, id: record.id.toString() })), total, page, limit };
  }

  async complaints({ status, page, limit, complainantRole }: AdminComplaintsQuery, facilityUserId?: string) {
    const where: Prisma.ComplaintWhereInput = {
      status,
      ...(complainantRole ? { complainantUser: { role: complainantRole } } : {}),
      ...(facilityUserId ? { contract: { facility: { userId: facilityUserId } } } : {}),
    };
    const [items, total] = await Promise.all([
      this.db.complaint.findMany({ where, select: complaintFields, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: (page - 1) * limit, take: limit }),
      this.db.complaint.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  async overview(period: AdminOverviewQuery['period'], environment: AdminOverviewQuery['environment'] = 'LIVE') {
    const { start, end, days } = windowInVietnam(period);
    const currentYear = new Date(Date.now() + 7 * 3600_000).getUTCFullYear();
    const isDemo = environment === 'TEST';
    const demoEmail = { endsWith: '@demo.famidoc.invalid' };
    const user = { status: 'ACTIVE', ...(isDemo ? { email: demoEmail } : { NOT: { email: demoEmail } }) } satisfies Prisma.UserWhereInput;
    const open = {
      status: { in: ['SUBMITTED', 'INVESTIGATING'] },
      contract: { isDemo },
    } satisfies Prisma.ComplaintWhereInput;
    const [paid, activeContracts, doctors, facilities, openComplaints, queue, rows] = await Promise.all([
      this.db.invoice.aggregate({
        where: { environment, paymentStatus: 'PAID', paidAt: { gte: new Date(Date.UTC(currentYear, 0, 1) - 7 * 3600_000), lte: new Date() } },
        _sum: { totalPayable: true },
      }),
      this.db.medicalContract.count({ where: { contractStatus: 'ACTIVE', isDemo } }),
      this.db.doctor.count({ where: { onboardingStatus: 'ACTIVE', user } }),
      this.db.healthcareFacility.count({ where: { verificationStatus: 'ACTIVE', user } }),
      this.db.complaint.count({ where: open }),
      this.db.complaint.findMany({ where: open, select: complaintFields, orderBy: { createdAt: 'desc' }, take: 5 }),
      this.db.encounter.groupBy({
        by: ['scheduledDate', 'encounterType', 'encounterStatus'],
        where: { scheduledDate: { gte: start, lt: end }, contract: { isDemo } },
        _count: { _all: true },
      }),
    ]);
    const buckets = new Map(days.map((date) => {
      const key = date.toISOString().slice(0, period === 'yearly' ? 7 : 10);
      return [key, { label: period === 'yearly' ? `T${date.getUTCMonth() + 1}` : `${date.getUTCDate()}/${date.getUTCMonth() + 1}`, HOME_VISIT: 0, TELEHEALTH: 0, FACILITY_VISIT: 0 }];
    }));
    const counts = { total: 0, completed: 0, pending: 0, cancelled: 0 };
    for (const row of rows) {
      const n = row._count._all;
      const bucket = buckets.get(row.scheduledDate.toISOString().slice(0, period === 'yearly' ? 7 : 10));
      if (bucket) bucket[row.encounterType] += n;
      counts.total += n;
      if (row.encounterStatus === 'COMPLETED') counts.completed += n;
      else if (row.encounterStatus === 'CANCELLED') counts.cancelled += n;
      else counts.pending += n;
    }
    return { gmvVnd: paid._sum.totalPayable ? moneyToNumber(paid._sum.totalPayable) : 0, activeContracts, doctors, facilities, openComplaints, queue, counts, series: [...buckets.values()] };
  }

  async updateDoctorPanelCapacity(
    actor: AuthenticatedUser,
    doctorId: string,
    dto: { maxPanelCapacity: number; reason: string },
    ip?: string,
  ) {
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM doctors WHERE id = ${doctorId}::uuid FOR UPDATE`;
      const doctor = await tx.doctor.findUnique({
        where: { id: doctorId },
        select: { id: true, doctorName: true, maxPanelCapacity: true },
      });
      if (!doctor) {
        throw new NotFoundException('Không tìm thấy bác sĩ');
      }

      const activeAndHeldCount = await tx.medicalContract.count({
        where: buildActiveAndHeldWhere(doctor.id),
      });
      if (dto.maxPanelCapacity < activeAndHeldCount) {
        throw new ConflictException(
          `Hạn mức mới (${dto.maxPanelCapacity}) không được thấp hơn số hộ gia đình đang hiệu lực/giữ chỗ (${activeAndHeldCount})`,
        );
      }

      const updated = await tx.doctor.update({
        where: { id: doctor.id },
        data: { maxPanelCapacity: dto.maxPanelCapacity },
        select: { id: true, doctorName: true, maxPanelCapacity: true, activePanelCount: true },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: actor.id,
          action: 'ADMIN_UPDATE_DOCTOR_PANEL_CAPACITY',
          resourceName: 'Doctor',
          resourceId: doctor.id,
          clientIp: (ip ?? 'unknown').slice(0, 45),
          metadata: {
            previousMaxPanel: doctor.maxPanelCapacity,
            newMaxPanel: dto.maxPanelCapacity,
            reason: dto.reason.trim(),
          },
        },
      });

      return updated;
    });
  }
}
