import { calculateMonthlyInvoiceShares } from '../../pricing/monthly-recognition';
import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { FacilitySettlement } from '@prisma/client';
import { PrismaService } from '../../../../core/database/prisma.service';
import { serializable } from '../../../../core/database/prisma-transaction';
import { writeBusinessAudit } from '../../../../core/business/business-helpers';
import {
  FINANCE_INVOICE_INCLUDE,
  type IFinanceRepository,
  type FinanceSession,
  type RevenueFilter,
} from '../interfaces/finance.repository.interface';
@Injectable()
export class FinanceRepositoryImpl implements IFinanceRepository {
  constructor(private readonly prisma: PrismaService) {}
  transaction<T>(work: (session: FinanceSession) => Promise<T>) {
    return serializable(this.prisma, (tx) =>
      work(new PrismaFinanceSession(tx)),
    );
  }
}
class PrismaFinanceSession implements FinanceSession {
  constructor(private readonly tx: Prisma.TransactionClient) {}
  // Điểm sao phục vụ giám sát chất lượng, không tham gia công thức tiền chi trả.
  async getSatisfactionSummary(filter: RevenueFilter) {
    const groups = await this.tx.doctorReview.groupBy({
      by: ['doctorId'],
      where: {
        createdAt: { gte: filter.start, lt: filter.end },
        encounter: {
          contract: {
            facilityId: filter.facilityId,
            isDemo: filter.environment === 'TEST',
          },
        },
      },
      _avg: { ratingStars: true },
      _count: true,
    });
    const reviewCount = groups.reduce((sum, r) => sum + r._count, 0);
    return {
      reviewCount,
      averageStars: reviewCount
        ? groups.reduce(
            (sum, r) => sum + (r._avg.ratingStars ?? 0) * r._count,
            0,
          ) / reviewCount
        : null,
      affectsPayout: false as const,
      byDoctor: groups.map((r) => ({
        doctorId: r.doctorId,
        averageStars: r._avg.ratingStars,
        reviewCount: r._count,
      })),
    };
  }
  findFacilityForUser(userId: string) {
    return this.tx.healthcareFacility.findUnique({
      where: { userId },
      select: { id: true },
    });
  }
  async findEligibleInvoices(filter: RevenueFilter) {
    const rows = await this.tx.invoice.findMany({
      where: {
        paymentStatus: 'PAID',
        paidAt: { lt: filter.end },
        environment: filter.environment,
        contract: {
          facilityId: filter.facilityId,
          isDemo: filter.environment === 'TEST',
          contractStatus: { in: ['ACTIVE', 'EXPIRED', 'TERMINATED'] },
          startDate: { lt: filter.end },
          endDate: { gt: filter.start },
        },
        acceptedTransaction: {
          outcome: 'MATCHED',
          signatureVerified: true,
          transferType: 'in',
          environment: filter.environment,
        },
        // Hóa đơn đã quyết toán trọn theo cách cũ không được chia thêm lần nữa.
        ...(filter.onlyUnsettled
          ? {
              settlementItems: {
                none: {
                  OR: [
                    { recognitionBasis: 'LEGACY_CASH' },
                    {
                      recognitionYear: new Date(
                        filter.end.getTime() + 7 * 3600000 - 1,
                      ).getUTCFullYear(),
                      recognitionMonth:
                        new Date(
                          filter.end.getTime() + 7 * 3600000 - 1,
                        ).getUTCMonth() + 1,
                    },
                  ],
                },
              },
            }
          : {}),
      },
      include: FINANCE_INVOICE_INCLUDE,
      orderBy: { id: 'asc' },
      take: 1001,
    });
    if (rows.length > 1000)
      throw new ConflictException(
        'Select one facility or a smaller reporting period; this request exceeds 1000 invoices',
      );
    // Phụ lục chưa cấp quyền thì chưa chia doanh thu, dù tiền đã được ghi nhận.
    return rows.filter(
      (r) =>
        (!r.addendumId || r.addendum?.status === 'ACTIVE') &&
        calculateMonthlyInvoiceShares(r, filter),
    );
  }
  countUnmatchedTransactions(filter: RevenueFilter) {
    return this.tx.paymentTransaction.count({
      where: {
        createdAt: { gte: filter.start, lt: filter.end },
        environment: filter.environment,
        outcome: 'REVIEW_REQUIRED',
      },
    });
  }
  findSettlements(filter: RevenueFilter, year: number, month: number) {
    return this.tx.facilitySettlement.findMany({
      where: {
        facilityId: filter.facilityId,
        environment: filter.environment,
        year,
        month,
      },
      orderBy: { facilityId: 'asc' },
    });
  }
  async findSettlement(id: string) {
    await this.tx
      .$queryRaw`SELECT id FROM facility_settlements WHERE id=${id}::uuid FOR UPDATE`;
    return this.tx.facilitySettlement.findUnique({ where: { id } });
  }
  findPeriodSettlement(
    facilityId: string,
    year: number,
    month: number,
    environment: string,
  ) {
    return this.tx.facilitySettlement.findUnique({
      where: {
        facilityId_month_year_environment: {
          facilityId,
          month,
          year,
          environment,
        },
      },
    });
  }
  createSettlement(data: Prisma.FacilitySettlementUncheckedCreateInput) {
    return this.tx.facilitySettlement.create({ data });
  }
  async createSettlementItems(
    data: Prisma.FacilitySettlementItemCreateManyInput[],
  ) {
    await this.tx.facilitySettlementItem.createMany({ data });
  }
  updateSettlement(
    id: string,
    data: Prisma.FacilitySettlementUncheckedUpdateInput,
  ) {
    return this.tx.facilitySettlement.update({ where: { id }, data });
  }
  async recordFinanceEvent(
    actorId: string,
    settlement: FacilitySettlement,
    action: string,
  ) {
    await writeBusinessAudit(
      this.tx,
      actorId,
      action,
      'facility_settlements',
      settlement.id,
    );
    const facility = await this.tx.healthcareFacility.findUniqueOrThrow({
      where: { id: settlement.facilityId },
      select: { userId: true },
    });
    await this.tx.notification.create({
      data: {
        userId: facility.userId,
        title: 'Cập nhật quyết toán',
        content: `Kỳ ${settlement.month}/${settlement.year}: ${settlement.disbursementStatus}.`,
        type: 'SETTLEMENT',
        referenceId: settlement.id,
      },
    });
  }
}
