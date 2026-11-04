import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type ServicePackage } from '@prisma/client';
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
import type {
  CarePackagesPage,
  CarePackagesRepository,
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
      facilityVisits: 0,
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
    basePrice: terms.priceVnd,
    includedMembers: terms.includedMembers,
    maxMembers: terms.maxMembers,
    additionalMemberMonthlyPrice: terms.additionalMemberMonthlyPriceVnd,
    quotaPeriod: terms.quotaPeriod,
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
  ): Promise<CarePackagesPage> {
    return serializable(this.prisma, async (tx) => {
      const where = { status };
      const total = await tx.servicePackage.count({ where });
      const rows = await tx.servicePackage.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ lineageCode: 'asc' }, { version: 'desc' }],
      });
      return { items: rows.map(toEntity), total, page, limit };
    });
  }

  async findById(id: string): Promise<CarePackage | null> {
    const row = await this.prisma.servicePackage.findUnique({ where: { id } });
    return row ? toEntity(row) : null;
  }

  async findLatestByCode(code: string): Promise<CarePackage | null> {
    const row = await this.prisma.servicePackage.findFirst({
      where: { lineageCode: code },
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
        throw new ConflictException(
          'Package version changed or a draft already exists',
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
            status: 'DRAFT',
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
      if (row.status !== 'DRAFT')
        throw new ConflictException('Published terms are immutable');
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
    return serializable(this.prisma, async (tx) => {
      const row = await this.requireRow(tx, id);
      if (row.status !== 'DRAFT')
        throw new ConflictException('Only a draft can be published');
      const latest = await tx.servicePackage.findFirst({
        where: { lineageCode: row.lineageCode },
        orderBy: { version: 'desc' },
      });
      if (latest?.id !== id)
        throw new ConflictException('Only the latest version can be published');
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
        throw new ConflictException('Only an active package can be retired');
      return toEntity(
        await tx.servicePackage.update({
          where: { id },
          data: { status: 'DEPRECATED', retiredAt: new Date() },
        }),
      );
    });
  }

  private async requireRow(tx: Prisma.TransactionClient, id: string) {
    const row = await tx.servicePackage.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Care package not found');
    return row;
  }
}
