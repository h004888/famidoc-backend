import { Injectable } from '@nestjs/common';
import { Prisma, type ServicePackage } from '@prisma/client';
import {
  BusinessConflictException,
  ResourceNotFoundException,
} from '../../../../core/exceptions/api.exception';
import { CarePackageErrorCode } from '../../../../core/constants/error-codes.constant';
import { PrismaService } from '../../../../core/database/prisma.service';
import {
  moneyToNumber,
  serializable,
} from '../../../../core/database/prisma-transaction';
import {
  CarePackageStatus,
  QuotaPeriod,
  type CarePackage,
  type CarePackageTerms,
} from '../../entities/care-package.entity';
import {
  DEMO_CARE_PACKAGE_CODES,
  DEMO_CARE_PACKAGE_IDS,
  type CarePackagesListOptions,
  type CarePackageAuditEntry,
  type CarePackagesPage,
  type CarePackagesRepository,
} from '../interfaces/care-packages.repository.interface';
import { validateCarePackageTerms } from '../../validate-care-package-terms';

function toEntity(row: ServicePackage): CarePackage {
  return {
    id: row.id,
    code: row.lineageCode,
    version: row.version,
    name: row.packageName,
    description: row.description,
    durationMonths: row.durationMonths,
    videoQuotaPolicy: row.videoQuotaPolicy as 'FIXED' | 'CONTRACT',
    homeVisitUnitPriceVnd: row.homeVisitUnitPrice
      ? moneyToNumber(row.homeVisitUnitPrice)
      : undefined,
    priceVnd: moneyToNumber(row.basePrice),
    includedMembers: row.includedMembers,
    maxMembers: row.maxMembers,
    additionalMemberMonthlyPriceVnd: moneyToNumber(
      row.additionalMemberMonthlyPrice,
    ),
    currency: 'VND',
    quotaPeriod: row.quotaPeriod as QuotaPeriod,
    quotas: {
      videoConsultations: row.telehealthQuota,
      homeVisits: row.periodicVisitsQuota,
    },
    status: row.status as CarePackageStatus,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    publishedAt: row.publishedAt?.toISOString() ?? null,
    retiredAt: row.retiredAt?.toISOString() ?? null,
  };
}

function termsData(terms: CarePackageTerms) {
  return {
    packageName: terms.name,
    description: terms.description,
    durationMonths: terms.durationMonths,
    videoQuotaPolicy: 'FIXED',
    homeVisitUnitPrice: terms.homeVisitUnitPriceVnd ?? null,
    basePrice: terms.priceVnd,
    includedMembers: terms.includedMembers,
    maxMembers: terms.maxMembers,
    additionalMemberMonthlyPrice: terms.additionalMemberMonthlyPriceVnd,
    quotaPeriod: QuotaPeriod.PER_TERM,
    telehealthQuota: terms.quotas.videoConsultations,
    periodicVisitsQuota: terms.quotas.homeVisits,
  };
}

@Injectable()
export class CarePackagesRepositoryImpl implements CarePackagesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    page: number,
    limit: number,
    status?: CarePackageStatus,
    options?: CarePackagesListOptions,
  ): Promise<CarePackagesPage> {
    return serializable(this.prisma, async (tx) => {
      const where: Prisma.ServicePackageWhereInput = {
        deletedAt: null,
        status: status ?? (options?.excludeDrafts ? { not: 'DRAFT' } : undefined),
      };
      if (options?.excludeDemo) {
        where.id = { notIn: DEMO_CARE_PACKAGE_IDS };
        where.lineageCode = { notIn: DEMO_CARE_PACKAGE_CODES };
      }
      const orderBy: Prisma.ServicePackageOrderByWithRelationInput[] = [
        { lineageCode: 'asc' },
        { version: 'desc' },
      ];
      if (options?.ascendingPrice) orderBy.unshift({ basePrice: 'asc' });
      // Danh mục không có bản nháp nên thứ tự enum đưa ACTIVE lên trước DEPRECATED.
      if (!status && options?.excludeDrafts) orderBy.unshift({ status: 'asc' });
      const total = await tx.servicePackage.count({ where });
      const rows = await tx.servicePackage.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy,
      });
      return { items: rows.map(toEntity), total, page, limit };
    });
  }

  async recordAudit(entry: CarePackageAuditEntry): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        actorUserId: entry.actorUserId ?? null,
        action: entry.action,
        resourceName: 'ServicePackage',
        resourceId: entry.packageId,
        clientIp: entry.clientIp?.slice(0, 45) ?? 'unknown',
        details: entry.details as Prisma.InputJsonValue,
      },
    });
  }

  async findById(id: string): Promise<CarePackage | null> {
    const row = await this.prisma.servicePackage.findFirst({
      where: { id, deletedAt: null },
    });
    return row ? toEntity(row) : null;
  }

  async findLatestByCode(code: string): Promise<CarePackage | null> {
    const row = await this.prisma.servicePackage.findFirst({
      where: { lineageCode: code, deletedAt: null },
      orderBy: { version: 'desc' },
    });
    return row ? toEntity(row) : null;
  }

  async insert(item: CarePackage): Promise<CarePackage> {
    return serializable(this.prisma, async (tx) => {
      const latest = await tx.servicePackage.findFirst({
        where: { lineageCode: item.code },
        orderBy: { version: 'desc' },
      });
      // Kiểm tra lại trong transaction vì request khác có thể vừa tạo phiên bản trước đó.
      if (
        item.version !== (latest?.version ?? 0) + 1 ||
        latest?.status === 'DRAFT'
      ) {
        throw new BusinessConflictException(
          CarePackageErrorCode.CARE_PACKAGE_CODE_EXISTS,
          'Phiên bản gói đã thay đổi hoặc đã tồn tại bản nháp. Vui lòng tải lại danh mục.',
        );
      }
      return toEntity(
        await tx.servicePackage.create({
          data: {
            ...termsData(item),
            id: item.id,
            packageCode:
              item.version === 1 ? item.code : `${item.code}_V${item.version}`,
            lineageCode: item.code,
            version: item.version,
            status: item.status,
            publishedAt: item.publishedAt,
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
          },
        }),
      );
    });
  }

  async updateDraft(
    id: string,
    changes: Partial<CarePackageTerms>,
  ): Promise<CarePackage> {
    return serializable(this.prisma, async (tx) => {
      const row = await this.requireRow(tx, id);
      if (row.status === 'DEPRECATED')
        throw new BusinessConflictException(
          CarePackageErrorCode.CARE_PACKAGE_DEPRECATED_READONLY,
          'Không thể chỉnh sửa gói dịch vụ đã ngừng bán.',
        );
      const merged = { ...toEntity(row), ...changes };
      validateCarePackageTerms(merged);
      return toEntity(
        await tx.servicePackage.update({
          where: { id },
          data: termsData(merged),
        }),
      );
    });
  }

  async publish(id: string): Promise<CarePackage> {
    return this.activate(id, 'DRAFT');
  }

  async reopen(id: string): Promise<CarePackage> {
    return this.activate(id, 'DEPRECATED');
  }

  private async activate(id: string, expectedStatus: 'DRAFT' | 'DEPRECATED'): Promise<CarePackage> {
    return serializable(this.prisma, async (tx) => {
      const row = await this.requireRow(tx, id);
      if (row.status !== expectedStatus)
        throw new BusinessConflictException(
          CarePackageErrorCode.CARE_PACKAGE_INACTIVE,
          expectedStatus === 'DRAFT'
            ? 'Chỉ có thể xuất bản gói đang ở trạng thái bản nháp.'
            : 'Chỉ có thể mở bán lại gói đã ngừng bán. Hãy tải lại danh mục.',
        );
      const latest = await tx.servicePackage.findFirst({
        where: {
          lineageCode: row.lineageCode,
          // Bản nháp cũ không chặn mở bán lại phiên bản đã từng bán gần nhất.
          status: expectedStatus === 'DEPRECATED' ? { not: 'DRAFT' } : undefined,
        },
        orderBy: { version: 'desc' },
      });
      if (latest?.id !== id)
        throw new BusinessConflictException(
          CarePackageErrorCode.CARE_PACKAGE_INACTIVE,
          expectedStatus === 'DRAFT'
            ? 'Chỉ có thể xuất bản phiên bản mới nhất của gói.'
            : 'Gói đã có phiên bản mới hơn. Vui lòng mở bán phiên bản mới nhất.',
        );
      validateCarePackageTerms(toEntity(row));
      const now = new Date();
      // Ngừng bản cũ trước khi bật bản mới; unique index trong DB bảo đảm chỉ có một ACTIVE/mã.
      await tx.servicePackage.updateMany({
        where: { lineageCode: row.lineageCode, status: 'ACTIVE' },
        data: { status: 'DEPRECATED', retiredAt: now },
      });
      return toEntity(
        await tx.servicePackage.update({
          where: { id },
          data: { status: 'ACTIVE', publishedAt: now, retiredAt: null },
        }),
      );
    });
  }

  async retire(id: string): Promise<CarePackage> {
    return serializable(this.prisma, async (tx) => {
      const row = await this.requireRow(tx, id);
      if (row.status === 'DEPRECATED') return toEntity(row);
      if (row.status !== 'ACTIVE')
        throw new BusinessConflictException(
          CarePackageErrorCode.CARE_PACKAGE_INACTIVE,
          'Chỉ có thể ngừng bán gói đang ở trạng thái mở bán.',
        );
      return toEntity(
        await tx.servicePackage.update({
          where: { id },
          data: { status: 'DEPRECATED', retiredAt: new Date() },
        }),
      );
    });
  }

  async softDelete(id: string): Promise<{ id: string; deletedAt: string }> {
    return serializable(this.prisma, async (tx) => {
      const row = await this.requireRow(tx, id);
      if (row.status === 'ACTIVE') {
        throw new BusinessConflictException(
          CarePackageErrorCode.CARE_PACKAGE_ACTIVE_DELETE_BLOCKED,
          'Không thể xóa gói đang mở bán. Vui lòng ngừng bán gói trước khi xóa.',
          'Không thể xóa gói đang mở bán. Vui lòng ngừng bán gói trước khi xóa.',
          {
            conditions: [
              {
                code: 'PKG_STATUS',
                condition: 'status phải là DEPRECATED hoặc DRAFT',
                message: 'Gói hiện đang ở trạng thái Đang bán (ACTIVE).',
              },
            ],
          },
        );
      }

      const contracts = await tx.medicalContract.count({ where: { packageId: id } });
      const matchingSessions = await tx.matchingSession.count({
        where: { servicePackage: { id } },
      });
      const matchingQueueRequests = await tx.matchingQueueRequest.count({
        where: { servicePackage: { id } },
      });
      const inUseCount = contracts + matchingSessions + matchingQueueRequests;
      if (inUseCount > 0) {
        const msg = `Không thể xóa gói vì đang có ${inUseCount} hợp đồng hoặc yêu cầu ghép nối sử dụng gói này.`;
        throw new BusinessConflictException(
          CarePackageErrorCode.CARE_PACKAGE_IN_USE,
          msg,
          msg,
          {
            conditions: [
              {
                code: 'PKG_IN_USE',
                condition: 'Không còn hợp đồng hoặc phiên ghép nối liên kết với gói',
                message: `Đang có ${inUseCount} hợp đồng/phiên ghép nối liên kết với gói.`,
              },
            ],
          },
        );
      }

      const now = new Date();
      await tx.servicePackage.update({
        where: { id },
        data: {
          status: 'DEPRECATED',
          deletedAt: now,
          retiredAt: row.retiredAt ?? now,
        },
      });
      return { id, deletedAt: now.toISOString() };
    });
  }

  private async requireRow(tx: Prisma.TransactionClient, id: string) {
    const row = await tx.servicePackage.findFirst({ where: { id, deletedAt: null } });
    if (!row)
      throw new ResourceNotFoundException(
        CarePackageErrorCode.CARE_PACKAGE_NOT_FOUND,
        'Không tìm thấy gói dịch vụ.',
      );
    return row;
  }
}
