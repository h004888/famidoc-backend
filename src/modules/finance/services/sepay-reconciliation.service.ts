import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
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
  ) {}

  async runManual(
    actor: { id: string; role: string },
    dto: RunSePayReconciliationDto,
  ) {
    if (actor.role !== 'ADMIN')
      throw new ForbiddenException('Only Admin can run SePay reconciliation');
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
    const [state, latestRun, unreconciledTransactions] = await Promise.all([
      this.prisma.sePayReconciliationState.findUnique({
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
      throw new BadRequestException('from and to must be provided together');
    const rangeFrom = dto?.from ? new Date(dto.from) : undefined;
    const rangeTo = dto?.to ? new Date(dto.to) : undefined;
    if (rangeFrom && rangeTo) {
      if (rangeFrom >= rangeTo)
        throw new BadRequestException('from must be earlier than to');
      if (rangeTo.getTime() - rangeFrom.getTime() > 31 * 86_400_000)
        throw new BadRequestException(
          'A reconciliation range cannot exceed 31 days',
        );
      if (rangeTo.getTime() > Date.now() + 300_000)
        throw new BadRequestException('to cannot be in the future');
    }

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
      throw new ConflictException('A SePay reconciliation is already running');

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
            'Reconciliation exceeded 100,000 transactions; use a smaller range',
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

  private assertActiveEnvironment(environment: PaymentEnvironment) {
    if (environment !== this.paymentsConfig.getEnvironment())
      throw new BadRequestException(
        `This backend instance is configured for ${this.paymentsConfig.getEnvironment()}, not ${environment}`,
      );
  }
}
