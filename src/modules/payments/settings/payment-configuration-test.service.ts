import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type PaymentConfigurationTestSession } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../../core/database/prisma.service';
import { PaymentsClock } from '../payments.clock';
import { PaymentSettingsService } from './payment-settings.service';
import {
  normalizeGateway,
  type PaymentTestSessionDto,
} from './payment-settings.dto';
import type { VerifiedPaymentContext } from '../guards/sepay-webhook.guard';

export function paymentTestStatus(
  session: { status: string; expiresAt: Date; finalizeAt: Date },
  now: Date,
): string {
  if (['SUCCEEDED', 'EXPIRED'].includes(session.status)) return session.status;
  if (now > session.finalizeAt) return 'EXPIRED';
  return now >= session.expiresAt ? 'WAITING_WEBHOOK' : 'PENDING';
}
export function classifyPaymentTest(text: string): {
  isTest: boolean;
  code: string | null;
  mixed: boolean;
} {
  const codes = [
    ...new Set(text.toUpperCase().match(/\bPTC[A-F0-9]{24}\b/g) ?? []),
  ];
  return {
    isTest: /\bPTC/i.test(text),
    code: codes.length === 1 ? codes[0] : null,
    mixed:
      codes.length > 1 || (codes.length > 0 && /\bFD[A-Z0-9]+/i.test(text)),
  };
}
interface AccountSnapshot {
  monitoredAccountId: string;
  accountNumber: string;
  gateway: string;
  bankAccountId: string;
}
export interface PaymentTestIncoming {
  environment: 'TEST' | 'LIVE';
  source: 'WEBHOOK' | 'SEPAY_API';
  providerTransactionId: string;
  gateway: string;
  accountNumber: string;
  amountVnd: number;
  text: string;
  transactionAt: Date;
  transferType: string;
  verified?: VerifiedPaymentContext;
  bankAccountId?: string;
}
@Injectable()
export class PaymentConfigurationTestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: PaymentSettingsService,
    private readonly clock: PaymentsClock,
  ) {}
  async create(dto: PaymentTestSessionDto, actorId: string) {
    if (
      !Number.isSafeInteger(dto.amountVnd) ||
      dto.amountVnd < 1000 ||
      dto.amountVnd > 100000
    )
      throw new BadRequestException('INVALID_TEST_AMOUNT');
    if (dto.environment !== this.settings.config.getEnvironment())
      throw new ConflictException('INACTIVE_PAYMENT_ENVIRONMENT');
    if (dto.environment === 'LIVE' && dto.confirmRealMoney !== true)
      throw new BadRequestException('REAL_MONEY_CONFIRMATION_REQUIRED');
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`payment-settings:${dto.environment}`}))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`payment-test:${actorId}`}))`;
      const prior = await tx.paymentConfigurationTestSession.findFirst({
        where: {
          actorId,
          OR: [
            { requestId: dto.requestId },
            { requestIds: { has: dto.requestId } },
          ],
        },
      });
      if (prior) return this.view(prior);
      const head = await tx.paymentSettingsHead.findUnique({
        where: { environment: dto.environment },
        include: { revision: true },
      });
      if (!head || head.version < 1 || head.version !== dto.revision)
        throw new ConflictException('SAVED_REVISION_REQUIRED');
      const now = this.clock.now();
      const open = await tx.paymentConfigurationTestSession.findFirst({
        where: {
          actorId,
          environment: dto.environment,
          status: { notIn: ['SUCCEEDED', 'EXPIRED'] },
          finalizeAt: { gte: now },
        },
      });
      if (open)
        return this.view(
          await tx.paymentConfigurationTestSession.update({
            where: { id: open.id },
            data: { requestIds: { push: dto.requestId } },
          }),
        );
      const revision = head.revision;
      const expiresAt = new Date(now.getTime() + 900_000);
      let code: string;
      do {
        code = 'PTC' + randomBytes(12).toString('hex').toUpperCase();
      } while (code.includes('FD'));
      const row = await tx.paymentConfigurationTestSession.create({
        data: {
          actorId,
          requestId: dto.requestId,
          revisionId: revision.id,
          environment: dto.environment,
          code,
          requestIds: [dto.requestId],
          amountVnd: dto.amountVnd,
          account: {
            monitoredAccountId: revision.monitoredAccountId,
            accountNumber: revision.accountNumber,
            gateway: revision.gateway,
            bankAccountId: revision.bankAccountId,
          },
          createdAt: now,
          expiresAt,
          finalizeAt: new Date(expiresAt.getTime() + 86_400_000),
          status: 'PENDING',
        },
      });
      return this.view(row);
    });
  }
  async get(id: string, actorId: string) {
    const row = await this.prisma.paymentConfigurationTestSession.findFirst({
      where: { id, actorId },
    });
    if (!row) throw new NotFoundException('PAYMENT_TEST_NOT_FOUND');
    return this.view(row);
  }
  private view(row: PaymentConfigurationTestSession) {
    const status = paymentTestStatus(row, this.clock.now()),
      account = row.account as unknown as AccountSnapshot;
    const url = new URL('https://vietqr.app/img');
    for (const [key, value] of Object.entries({
      acc: account.accountNumber,
      bank: account.gateway,
      amount: String(row.amountVnd),
      des: row.code,
      template: 'qronly',
    }))
      url.searchParams.set(key, value);
    return {
      id: row.id,
      environment: row.environment,
      revisionId: row.revisionId,
      amountVnd: row.amountVnd,
      code: row.code,
      account: {
        gateway: account.gateway,
        accountNumber: account.accountNumber,
      },
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      finalizeAt: row.finalizeAt,
      status,
      observation:
        row.apiSeenAt && status !== 'SUCCEEDED'
          ? 'API_SEEN_WEBHOOK_PENDING'
          : null,
      webhookMatchedAt: row.webhookMatchedAt,
      apiSeenAt: row.apiSeenAt,
      qrUrl:
        status === 'PENDING' && process.env.PAYMENTS_MODE !== 'simulation'
          ? url.href
          : null,
    };
  }
  async dispatch(
    input: PaymentTestIncoming,
  ): Promise<{ handled: boolean; success?: boolean }> {
    const classification = classifyPaymentTest(input.text);
    if (!classification.isTest) return { handled: false };
    const receivedAt = this.clock.now();
    return this.prisma.$transaction(async (tx) => {
      // One session lock serializes different API/webhook deliveries and terminal transitions.
      if (classification.code)
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`payment-delivery:${classification.code}`}))`;
      const row = classification.code
        ? await tx.paymentConfigurationTestSession.findUnique({
            where: { code: classification.code },
          })
        : null;
      const account = row?.account as unknown as AccountSnapshot | undefined;
      const accountMatch = Boolean(
        row &&
        row.environment === input.environment &&
        account &&
        account.accountNumber === input.accountNumber &&
        normalizeGateway(account.gateway) === normalizeGateway(input.gateway) &&
        (input.source === 'WEBHOOK'
          ? input.verified?.environment === row.environment &&
            input.verified.monitoredAccountIds.includes(
              account.monitoredAccountId,
            )
          : input.bankAccountId === account.bankAccountId),
      );
      const amountMatch = Boolean(
        row && row.amountVnd === input.amountVnd && input.transferType === 'in',
      );
      const timeMatch = Boolean(
        row &&
        Number.isFinite(+input.transactionAt) &&
        +input.transactionAt >= +row.createdAt - 300000 &&
        +input.transactionAt <= +row.expiresAt + 300000 &&
        receivedAt <= row.finalizeAt,
      );
      const data = {
        sessionId: row?.id,
        environment: input.environment,
        source: input.source,
        providerTransactionId: input.providerTransactionId,
        fingerprint: createHash('sha256')
          .update(
            JSON.stringify([
              input.text,
              input.accountNumber,
              input.amountVnd,
              input.transactionAt,
            ]),
          )
          .digest('hex'),
        accountMatch,
        amountMatch,
        receivedAt,
        evidence: {
          codeMatch: Boolean(row && !classification.mixed),
          timeMatch,
          mixed: classification.mixed,
        } as Prisma.InputJsonValue,
      };
      const delivery = await tx.paymentConfigurationTestDelivery.createMany({
        data: [data],
        skipDuplicates: true,
      });
      if (!delivery.count || !row)
        return { handled: true, success: row?.status === 'SUCCEEDED' };
      const valid =
        accountMatch &&
        amountMatch &&
        timeMatch &&
        !classification.mixed &&
        row.status !== 'EXPIRED';
      if (valid && input.source === 'WEBHOOK')
        await tx.paymentConfigurationTestSession.update({
          where: { id: row.id },
          data: {
            status: 'SUCCEEDED',
            webhookMatchedAt: row.webhookMatchedAt ?? receivedAt,
          },
        });
      else if (valid && input.source === 'SEPAY_API')
        await tx.paymentConfigurationTestSession.update({
          where: { id: row.id },
          data: { apiSeenAt: row.apiSeenAt ?? receivedAt },
        });
      return {
        handled: true,
        success:
          (valid && input.source === 'WEBHOOK') || row.status === 'SUCCEEDED',
      };
    });
  }
}
