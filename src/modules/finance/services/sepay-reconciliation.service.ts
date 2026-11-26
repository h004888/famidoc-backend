import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma, type SePayReconciliationRun } from '@prisma/client';
import { PrismaService } from '../../../core/database/prisma.service';
import { PaymentsConfig } from '../../payments/payments.config';
import { SePayApiClient } from '../../payments/sepay/sepay-api.client';
import { SePayReconciliationConfig } from '../../payments/sepay/sepay-reconciliation.config';
import type { PaymentEnvironment } from '../../payments/sepay/sepay-api.types';
import {
  PAYMENTS_SERVICE_TOKEN,
  type IPaymentsService,
} from '../../payments/services/interfaces/payments.service.interface';
import { TransactionOutcome } from '../../payments/entities/payment.entity';
import type {
  RunSePayReconciliationDto,
  SePayReconciliationQueryDto,
} from '../dtos/finance.dto';
import { randomUUID } from 'node:crypto';
import { PaymentSettingsService } from '../../payments/settings/payment-settings.service';
import type { PaymentSettingsSnapshot } from '../../payments/settings/payment-settings.dto';
import { summarizeReconciliation, reconciliationCountKeys } from './payment-reconciliation-batch';

type ReconciliationTrigger = 'MANUAL' | 'SCHEDULED';

@Injectable()
export class SePayReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly api: SePayApiClient,
    private readonly config: SePayReconciliationConfig,
    private readonly paymentsConfig: PaymentsConfig,
    @Inject(PAYMENTS_SERVICE_TOKEN)
    private readonly payments: IPaymentsService,
    @Optional() private readonly settings?: PaymentSettingsService,
  ) {}

  async runManual(
    actor: { id: string; role: string },
    dto: RunSePayReconciliationDto,
  ) {
    if (actor.role !== 'ADMIN')
      throw new ForbiddenException('Chỉ Quản trị viên mới có quyền chạy đối soát SePay.');
    return this.run('MANUAL', dto.environment, dto, actor.id);
  }

  runScheduled() {
    return this.run(
      'SCHEDULED',
      this.paymentsConfig.getEnvironment(),
      undefined,
    );
  }

  async listRuns(query: SePayReconciliationQueryDto) {
    this.assertActiveEnvironment(query.environment);
    return this.prisma.sePayReconciliationRun.findMany({
      where: { environment: query.environment },
      orderBy: { startedAt: 'desc' },
      take: query.limit,
    });
  }

  async getStatus(environment: PaymentEnvironment) {
    this.assertActiveEnvironment(environment);
    const snapshot = this.settings ? await this.settings.repository.current(environment) : null;
    const [state, latestRun, unreconciledTransactions] = await Promise.all([
      snapshot?.monitoredAccountId ? this.prisma.paymentAccountReconciliationState.findUnique({
        where: { environment_monitoredAccountId: { environment, monitoredAccountId: snapshot.monitoredAccountId } },
      }) : this.settings ? Promise.resolve(null) : this.prisma.sePayReconciliationState.findUnique({
        where: { environment },
      }),
      this.prisma.sePayReconciliationRun.findFirst({
        where: { environment },
        orderBy: { startedAt: 'desc' },
      }),
      this.prisma.paymentTransaction.count({
        where: {
          environment,
          transferType: 'in',
          sepayApiTransactionId: null,
        },
      }),
    ]);
    return {
      environment,
      enabled: this.config.isEnabled(),
      state,
      latestRun,
      unreconciledTransactions,
    };
  }

  private async run(
    trigger: ReconciliationTrigger,
    environment: PaymentEnvironment,
    dto?: RunSePayReconciliationDto,
    requestedByUserId?: string,
  ) {
    this.assertActiveEnvironment(environment);
    const explicitRange = Boolean(dto?.from || dto?.to);
    if (explicitRange && (!dto?.from || !dto.to))
      throw new BadRequestException('Vui lòng cung cấp đầy đủ cả thời điểm bắt đầu và kết thúc.');
    const rangeFrom = dto?.from ? new Date(dto.from) : undefined;
    const rangeTo = dto?.to ? new Date(dto.to) : undefined;
    if (rangeFrom && rangeTo) {
      if (rangeFrom >= rangeTo)
        throw new BadRequestException('Thời điểm bắt đầu phải sớm hơn thời điểm kết thúc.');
      if (rangeTo.getTime() - rangeFrom.getTime() > 31 * 86_400_000)
        throw new BadRequestException(
          'Khoảng thời gian đối soát tối đa không được vượt quá 31 ngày.',
        );
      if (rangeTo.getTime() > Date.now() + 300_000)
        throw new BadRequestException('Thời điểm kết thúc không được ở tương lai.');
    }

    if (this.settings) return this.runBatch(trigger, environment, requestedByUserId, rangeFrom, rangeTo);

    await this.prisma.sePayReconciliationState.upsert({
      where: { environment },
      create: { environment },
      update: {},
    });
    const now = new Date();
    const lock = await this.prisma.sePayReconciliationState.updateMany({
      where: {
        environment,
        OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
      },
      data: { lockedUntil: new Date(now.getTime() + 30 * 60_000) },
    });
    if (!lock.count)
      throw new ConflictException('Đang có một lượt đồng bộ SePay khác đang chạy. Vui lòng đợi hoàn tất.');

    const state = await this.prisma.sePayReconciliationState.findUniqueOrThrow({
      where: { environment },
    });
    const cursorBefore = explicitRange ? null : state.cursor;
    const effectiveFrom = explicitRange
      ? rangeFrom
      : cursorBefore
        ? undefined
        : new Date(Date.now() - this.config.getLookbackMilliseconds());
    const effectiveTo = explicitRange ? rangeTo : new Date();
    let run: SePayReconciliationRun;
    try {
      run = await this.prisma.sePayReconciliationRun.create({
        data: {
          environment,
          trigger,
          status: 'RUNNING',
          requestedByUserId,
          rangeFrom: effectiveFrom,
          rangeTo: effectiveTo,
          cursorBefore,
        },
      });
    } catch (error) {
      await this.prisma.sePayReconciliationState.update({
        where: { environment },
        data: { lockedUntil: null },
      });
      throw error;
    }

    const counts = {
      fetchedCount: 0,
      backfilledCount: 0,
      linkedCount: 0,
      matchedCount: 0,
      reviewRequiredCount: 0,
      ignoredCount: 0,
      localOnlyCount: 0,
    };
    const errors: { transactionId?: string; message: string }[] = [];
    let cursorAfter = cursorBefore;
    try {
      const bankAccountId = this.config.getBankAccountId(environment);
      let pageNumber = 1;
      let hasMore = true;
      while (hasMore) {
        if (pageNumber > 1000)
          throw new ConflictException(
            'Số giao dịch đối soát vượt quá 100.000 bản ghi; vui lòng chọn khoảng thời gian ngắn hơn.',
          );
        const page = await this.api.listTransactions(environment, {
          bankAccountId,
          page: pageNumber,
          perPage: 100,
          sinceId: cursorBefore ?? undefined,
          from: effectiveFrom,
          to: effectiveTo,
        });
        for (const transaction of page.transactions) {
          counts.fetchedCount++;
          try {
            const result = await this.payments.handleSePayApiTransaction(
              transaction,
              run.id,
            );
            if (!result.duplicate) counts.backfilledCount++;
            if (result.linked) counts.linkedCount++;
            if (result.transaction.outcome === TransactionOutcome.MATCHED)
              counts.matchedCount++;
            else if (
              result.transaction.outcome === TransactionOutcome.REVIEW_REQUIRED
            )
              counts.reviewRequiredCount++;
            else counts.ignoredCount++;
            cursorAfter = transaction.id;
          } catch (error) {
            errors.push({
              transactionId: transaction.id,
              message:
                error instanceof Error
                  ? error.message.slice(0, 500)
                  : 'Unknown transaction processing error',
            });
          }
        }
        hasMore = page.hasMore;
        pageNumber++;
        if (hasMore)
          await new Promise<void>((resolve) => setTimeout(resolve, 350));
      }

      if (effectiveFrom && effectiveTo) {
        counts.localOnlyCount = await this.prisma.paymentTransaction.count({
          where: {
            environment,
            accountNumber: this.paymentsConfig.getDestination().accountNumber,
            paymentTime: { gte: effectiveFrom, lte: effectiveTo },
            sepayApiTransactionId: null,
          },
        });
      }
      const status =
        errors.length || counts.localOnlyCount ? 'PARTIAL' : 'SUCCEEDED';
      const completedAt = new Date();
      const updated = await this.prisma.sePayReconciliationRun.update({
        where: { id: run.id },
        data: {
          ...counts,
          status,
          cursorAfter:
            errors.length || explicitRange ? cursorBefore : cursorAfter,
          errors: errors.slice(0, 100) as Prisma.InputJsonValue,
          completedAt,
        },
      });
      await this.prisma.sePayReconciliationState.update({
        where: { environment },
        data: {
          cursor: errors.length || explicitRange ? state.cursor : cursorAfter,
          lastSuccessfulAt: status === 'SUCCEEDED' ? completedAt : undefined,
          lastRunId: run.id,
          lockedUntil: null,
        },
      });
      return updated;
    } catch (error) {
      const message =
        error instanceof Error ? error.message.slice(0, 500) : 'Unknown error';
      await this.prisma.sePayReconciliationRun.update({
        where: { id: run.id },
        data: {
          ...counts,
          status: 'FAILED',
          errors: [{ message }] as Prisma.InputJsonValue,
          completedAt: new Date(),
        },
      });
      await this.prisma.sePayReconciliationState.update({
        where: { environment },
        data: { lastRunId: run.id, lockedUntil: null },
      });
      throw error;
    }
  }

  private async runBatch(trigger: ReconciliationTrigger, environment: PaymentEnvironment, requestedByUserId?: string, rangeFrom?: Date, rangeTo?: Date) {
    try {
      return await this.executeBatch(trigger, environment, requestedByUserId, rangeFrom, rangeTo);
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      throw new ServiceUnavailableException('PAYMENT_RECONCILIATION_STORAGE_UNAVAILABLE');
    }
  }

  private async executeBatch(trigger: ReconciliationTrigger, environment: PaymentEnvironment, requestedByUserId?: string, rangeFrom?: Date, rangeTo?: Date) {
    const accounts = await this.settings!.repository.forAccounts(environment);
    if (!accounts.length) throw new ConflictException('NO_MONITORED_ACCOUNT');
    const batch = await this.prisma.paymentReconciliationBatch.create({ data: { environment, trigger, requestedByUserId, rangeFrom, rangeTo, status: 'RUNNING' } });
    const runs: SePayReconciliationRun[] = [];
    for (const account of accounts) runs.push(await this.runForAccount(account, batch.id, trigger, requestedByUserId, rangeFrom, rangeTo));
    const { status, counts } = summarizeReconciliation(runs);
    const errors = runs.flatMap(run => (Array.isArray(run.errors) ? run.errors : []).map(error => ({ monitoredAccountId: run.monitoredAccountId, runId: run.id, code: 'ACCOUNT_RECONCILIATION_FAILED', message: typeof error === 'object' && error && 'message' in error ? String(error.message) : 'Account reconciliation failed' })));
    const completed = await this.prisma.paymentReconciliationBatch.update({ where: { id: batch.id }, data: { status, counts, errors, completedAt: new Date() } });
    return { ...completed, ...counts, resultKind: 'BATCH' as const, runs };
  }

  private async runForAccount(snapshot: PaymentSettingsSnapshot, batchId: string, trigger: ReconciliationTrigger, requestedByUserId?: string, rangeFrom?: Date, rangeTo?: Date): Promise<SePayReconciliationRun> {
    const environment = snapshot.environment, monitoredAccountId = snapshot.monitoredAccountId!;
    const key = { environment, monitoredAccountId }, leaseOwner = randomUUID();
    const counts = Object.fromEntries(reconciliationCountKeys.map(key => [key, 0])) as Record<typeof reconciliationCountKeys[number], number>;
    const run = await this.prisma.sePayReconciliationRun.create({ data: { environment, monitoredAccountId, batchId, trigger, requestedByUserId, rangeFrom, rangeTo, status: 'RUNNING' } });
    const errors: { message: string; transactionId?: string }[] = [];
    let ownsLease = false;
    const heartbeat = async () => {
      const now = new Date();
      const renewed = await this.prisma.paymentAccountReconciliationState.updateMany({ where: { ...key, leaseOwner, lockedUntil: { gt: now } }, data: { lockedUntil: new Date(+now + 1800000) } });
      if (!renewed.count) throw new ConflictException('ACCOUNT_LEASE_LOST');
    };
    try {
      await this.prisma.paymentAccountReconciliationState.upsert({ where: { environment_monitoredAccountId: key }, create: key, update: {} });
      const now = new Date();
      const lock = await this.prisma.paymentAccountReconciliationState.updateMany({ where: { ...key, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] }, data: { leaseOwner, lockedUntil: new Date(+now + 1800000) } });
      if (!lock.count) throw new ConflictException('ACCOUNT_LOCKED');
      ownsLease = true;
      const state = await this.prisma.paymentAccountReconciliationState.findUniqueOrThrow({ where: { environment_monitoredAccountId: key } });
      const explicitRange = Boolean(rangeFrom), cursorBefore = explicitRange ? null : state.cursor;
      let cursorAfter = cursorBefore;
      const from = rangeFrom ?? (cursorBefore ? undefined : new Date(Date.now() - this.config.getLookbackMilliseconds()));
      const to = rangeTo ?? new Date();
      await this.prisma.sePayReconciliationRun.update({ where: { id: run.id }, data: { cursorBefore, rangeFrom: from, rangeTo: to } });
      for (let pageNumber = 1; ; pageNumber++) {
        if (pageNumber > 1000) throw new ConflictException('ACCOUNT_RANGE_TOO_LARGE');
        await heartbeat();
        const page = await this.api.listTransactions(environment, { bankAccountId: snapshot.bankAccountId, page: pageNumber, perPage: 100, sinceId: cursorBefore ?? undefined, from, to }, { apiToken: snapshot.apiToken });
        await heartbeat();
        for (const transaction of page.transactions) {
          try {
            if (transaction.account_number !== snapshot.accountNumber || transaction.bank_account_id !== snapshot.bankAccountId || transaction.bank_brand_name.trim().toLowerCase() !== snapshot.gateway.trim().toLowerCase()) throw new Error('PROVIDER_ACCOUNT_MISMATCH');
            const result = await this.payments.handleSePayApiTransaction(transaction, run.id);
            cursorAfter = transaction.id;
            if (result.testOnly) continue;
            counts.fetchedCount++;
            if (!result.duplicate) counts.backfilledCount++;
            if (result.linked) counts.linkedCount++;
            if (result.transaction.outcome === TransactionOutcome.MATCHED) counts.matchedCount++;
            else if (result.transaction.outcome === TransactionOutcome.REVIEW_REQUIRED) counts.reviewRequiredCount++;
            else counts.ignoredCount++;
          } catch { errors.push({ transactionId: transaction.id, message: 'TRANSACTION_RECONCILIATION_FAILED' }); }
        }
        await heartbeat();
        if (!page.hasMore) break;
        await new Promise<void>(resolve => setTimeout(resolve, 350));
      }
      if (from) counts.localOnlyCount = await this.prisma.paymentTransaction.count({ where: { environment, accountNumber: snapshot.accountNumber, gateway: { equals: snapshot.gateway, mode: 'insensitive' }, paymentTime: { gte: from, lte: to }, sepayApiTransactionId: null } });
      const status = errors.length || counts.localOnlyCount ? 'PARTIAL' : 'SUCCEEDED';
      const completedAt = new Date();
      return await this.prisma.$transaction(async tx => {
        const updated = await tx.paymentAccountReconciliationState.updateMany({ where: { ...key, leaseOwner, lockedUntil: { gt: completedAt } }, data: { cursor: explicitRange || errors.length ? state.cursor : cursorAfter, lastRunId: run.id, lastSuccessfulAt: status === 'SUCCEEDED' ? completedAt : undefined, leaseOwner: null, lockedUntil: null } });
        if (!updated.count) throw new ConflictException('ACCOUNT_LEASE_LOST');
        return tx.sePayReconciliationRun.update({ where: { id: run.id }, data: { ...counts, status, cursorAfter: explicitRange || errors.length ? cursorBefore : cursorAfter, errors: errors.slice(0, 100), completedAt } });
      });
    } catch (error) {
      const message = error instanceof ConflictException ? (error.message.startsWith('ACCOUNT_') ? error.message : 'ACCOUNT_CONFLICT') : 'ACCOUNT_PROVIDER_UNAVAILABLE';
      return this.prisma.sePayReconciliationRun.update({ where: { id: run.id }, data: { ...counts, status: 'FAILED', errors: [...errors.slice(0, 99), { message }], completedAt: new Date() } });
    } finally {
      if (ownsLease) await this.prisma.paymentAccountReconciliationState.updateMany({ where: { ...key, leaseOwner }, data: { leaseOwner: null, lockedUntil: null } });
    }
  }

  private assertActiveEnvironment(environment: PaymentEnvironment) {
    if (environment !== this.paymentsConfig.getEnvironment())
      throw new BadRequestException(
        `Hệ thống hiện đang cấu hình ở môi trường ${this.paymentsConfig.getEnvironment()}, không hỗ trợ thao tác trên môi trường ${environment}.`,
      );
  }
}
