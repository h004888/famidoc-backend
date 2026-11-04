import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AuthenticatedUser } from '../../../../core/auth/authenticated-request';
import { getVietnamMonthWindow } from '../../../../core/business/business-helpers';
import { moneyToNumber } from '../../../../core/database/prisma-transaction';
import {
  FINANCE_REPOSITORY_TOKEN,
  type IFinanceRepository,
  type RevenueFilter,
  type RevenueInvoice,
} from '../../repositories/interfaces/finance.repository.interface';
import type { IFinanceService } from '../interfaces/finance.service.interface';
import type {
  MonthlySettlementDto,
  RevenueAnalyticsQueryDto,
} from '../../dtos/finance.dto';
import { calculateRevenueShares } from '../../pricing/revenue-sharing';
@Injectable()
export class FinanceServiceImpl implements IFinanceService {
  constructor(
    @Inject(FINANCE_REPOSITORY_TOKEN)
    private readonly repository: IFinanceRepository,
  ) {}
  getRevenueAnalytics(
    actor: AuthenticatedUser,
    query: RevenueAnalyticsQueryDto,
  ) {
    const period = this.resolveReportingPeriod(query);
    return this.repository.transaction(async (session) => {
      if (!['ADMIN', 'HEALTHCARE_FACILITY'].includes(actor.role))
        throw new ForbiddenException('Finance access is restricted');
      let facilityId = query.facilityId;
      if (actor.role === 'HEALTHCARE_FACILITY') {
        const facility = await session.findFacilityForUser(actor.id);
        if (!facility || (facilityId && facilityId !== facility.id))
          throw new NotFoundException('Facility not found');
        facilityId = facility.id;
      }
      const filter: RevenueFilter = {
        ...getVietnamMonthWindow(period.year, period.month),
        environment: query.environment,
        facilityId,
      };
      const invoices = await session.findEligibleInvoices(filter);
      const totals = {
        grossVnd: 0,
        vatVnd: 0,
        netVnd: 0,
        platformFeeVnd: 0,
        facilityShareVnd: 0,
      };
      for (const invoice of invoices) {
        const amount = this.getInvoiceShares(invoice);
        for (const key of Object.keys(totals) as (keyof typeof totals)[])
          totals[key] += amount[key];
      }
      return {
        ...period,
        environment: query.environment,
        facilityId: facilityId ?? null,
        currency: 'VND' as const,
        invoiceCount: invoices.length,
        ...totals,
        // CSYT không xem nhật ký giao dịch chưa xác định của đơn vị khác.
        unmatchedTransactionsCount:
          actor.role === 'ADMIN'
            ? await session.countUnmatchedTransactions(filter)
            : undefined,
        settlements: await session.findSettlements(
          filter,
          period.year,
          period.month,
        ),
      };
    });
  }
  executeMonthlySettlement(
    actor: AuthenticatedUser,
    dto: MonthlySettlementDto,
  ) {
    if (actor.role !== 'ADMIN')
      throw new ForbiddenException(
        'Only Admin can prepare or confirm settlements',
      );
    const period = this.resolveReportingPeriod(dto);
    if (dto.action !== 'PREPARE') return this.recordTransferResult(actor, dto);
    const vnNow = new Date(Date.now() + 7 * 3600000);
    if (
      period.year * 12 + period.month >=
      vnNow.getUTCFullYear() * 12 + vnNow.getUTCMonth() + 1
    )
      throw new BadRequestException('Only closed months can be settled');
    return this.repository.transaction(async (session) => {
      const filter: RevenueFilter = {
        ...getVietnamMonthWindow(period.year, period.month),
        environment: dto.environment,
        facilityId: dto.facilityId,
        onlyUnsettled: true,
      };
      const invoices = await session.findEligibleInvoices(filter);
      const groups = new Map<string, RevenueInvoice[]>();
      for (const invoice of invoices) {
        if (!invoice.contract) continue;
        const key = invoice.contract.facilityId;
        groups.set(key, [...(groups.get(key) ?? []), invoice]);
      }
      for (const [facilityId, items] of groups) {
        let settlement = await session.findPeriodSettlement(
          facilityId,
          period.year,
          period.month,
          dto.environment,
        );
        if (settlement && settlement.disbursementStatus !== 'PENDING')
          throw new ConflictException(
            'Late invoices require a reviewed adjustment; the settled statement is immutable',
          );
        const facility = items[0].contract!.facility;
        if (!settlement)
          settlement = await session.createSettlement({
            settlementCode:
              'ST' + randomUUID().replaceAll('-', '').toUpperCase(),
            facilityId,
            ...period,
            environment: dto.environment,
            totalRealizedRevenue: 0,
            platformFeeAmount: 0,
            facilityPayoutAmount: 0,
            bankDestination: {
              bankName: facility.bankName,
              accountNumber: facility.bankAccountNumber,
              accountHolder: facility.bankAccountHolder,
            },
          });
        let revenue = 0,
          fee = 0,
          payout = 0;
        const lines = items.map((invoice) => {
          const shares = this.getInvoiceShares(invoice);
          revenue += shares.netVnd;
          fee += shares.platformFeeVnd;
          payout += shares.facilityShareVnd;
          return {
            settlementId: settlement!.id,
            invoiceId: invoice.id,
            grossAmount: shares.grossVnd,
            vatAmount: shares.vatVnd,
            netAmount: shares.netVnd,
            platformFeeAmount: shares.platformFeeVnd,
            facilityShareAmount: shares.facilityShareVnd,
          };
        });
        // Unique invoice_id ngăn một hóa đơn bị đưa vào hai kỳ hoặc cộng lại khi API bị gọi trùng.
        await session.createSettlementItems(lines);
        settlement = await session.updateSettlement(settlement.id, {
          totalRealizedRevenue: { increment: revenue },
          platformFeeAmount: { increment: fee },
          facilityPayoutAmount: { increment: payout },
        });
        await session.recordFinanceEvent(
          actor.id,
          settlement,
          'PREPARE_MONTHLY_SETTLEMENT',
        );
      }
      return {
        ...period,
        environment: dto.environment,
        transferExecuted: false as const,
        message:
          'Statements prepared. Confirm only after the bank transfer has actually been reconciled.',
        settlements: await session.findSettlements(
          filter,
          period.year,
          period.month,
        ),
      };
    });
  }
  private recordTransferResult(
    actor: AuthenticatedUser,
    dto: MonthlySettlementDto,
  ) {
    return this.repository.transaction(async (session) => {
      const item = await session.findSettlement(dto.settlementId!);
      if (!item || item.environment !== dto.environment)
        throw new NotFoundException('Settlement not found');
      if (
        (dto.year !== undefined && dto.year !== item.year) ||
        (dto.month !== undefined && dto.month !== item.month)
      )
        throw new BadRequestException(
          'Settlement period does not match the selected statement',
        );
      if (item.disbursementStatus === 'SETTLED') {
        if (
          dto.action === 'CONFIRM_TRANSFER' &&
          item.bankTransferOrderId === dto.bankTransferOrderId &&
          moneyToNumber(item.facilityPayoutAmount) === dto.amountPaidVnd
        )
          return item;
        throw new ConflictException('Settled statements cannot be overwritten');
      }
      if (dto.action === 'MARK_FAILED') {
        const updated = await session.updateSettlement(item.id, {
          disbursementStatus: 'FAILED',
          failureReason: dto.failureReason,
        });
        await session.recordFinanceEvent(
          actor.id,
          updated,
          'MARK_SETTLEMENT_FAILED',
        );
        return updated;
      }
      if (dto.amountPaidVnd !== moneyToNumber(item.facilityPayoutAmount))
        throw new BadRequestException(
          'Transferred amount does not match the facility share',
        );
      if (
        !dto.evidenceKey?.startsWith(`${actor.id}/settlements/`) ||
        dto.evidenceKey.includes('..')
      )
        throw new BadRequestException(
          'Provide your settlement evidence object key',
        );
      const paidAt = new Date(dto.paidAt!);
      if (paidAt > new Date() || paidAt < item.createdAt)
        throw new BadRequestException(
          'Transfer time must be between statement creation and now',
        );
      // Đây là xác nhận đối soát thủ công bởi Admin, không phải hàm tự chuyển tiền ngân hàng.
      const updated = await session.updateSettlement(item.id, {
        disbursementStatus: 'SETTLED',
        bankTransferOrderId: dto.bankTransferOrderId,
        settledAt: paidAt,
        transferEvidenceKey: dto.evidenceKey,
        confirmedByUserId: actor.id,
      });
      await session.recordFinanceEvent(
        actor.id,
        updated,
        'CONFIRM_SETTLEMENT_TRANSFER',
      );
      return updated;
    });
  }
  private getInvoiceShares(invoice: RevenueInvoice) {
    return calculateRevenueShares(
      moneyToNumber(invoice.totalPayable),
      moneyToNumber(invoice.vatAmount),
    );
  }
  private resolveReportingPeriod(query: RevenueAnalyticsQueryDto) {
    if (query.environment === 'TEST' && process.env.NODE_ENV === 'production')
      throw new ForbiddenException(
        'TEST finance reports are disabled in production',
      );
    if ((query.year === undefined) !== (query.month === undefined))
      throw new BadRequestException('Provide both year and month');
    const prev = new Date(Date.now() + 7 * 3600000);
    prev.setUTCDate(1);
    prev.setUTCMonth(prev.getUTCMonth() - 1);
    return {
      year: query.year ?? prev.getUTCFullYear(),
      month: query.month ?? prev.getUTCMonth() + 1,
    };
  }
}
