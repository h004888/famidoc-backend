import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma, type PaymentSettingsRevision } from '@prisma/client';
import { PrismaService } from '../../../core/database/prisma.service';
import {
  PaymentSettingsCrypto,
  type EncryptedPaymentSecret,
} from './payment-settings.crypto';
import {
  normalizeGateway,
  type PaymentSettingsSnapshot,
} from './payment-settings.dto';

type Secrets = {
  apiToken: string;
  webhookSecret?: string;
  webhookApiKey?: string;
};
@Injectable()
export class PaymentSettingsRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: PaymentSettingsCrypto,
  ) {}

  snapshot(row: PaymentSettingsRevision): PaymentSettingsSnapshot {
    const secrets = JSON.parse(
      this.crypto.decrypt(
        row.encryptedSecrets as unknown as EncryptedPaymentSecret,
      ),
    ) as Secrets;
    return {
      environment: row.environment as 'TEST' | 'LIVE',
      revision: row.version,
      revisionId: row.id,
      monitoredAccountId: row.monitoredAccountId,
      accountNumber: row.accountNumber,
      gateway: row.gateway,
      bankAccountId: row.bankAccountId,
      authMethod: row.authMethod as 'hmac' | 'apikey',
      ...secrets,
      ttlMinutes: 15,
    };
  }
  async current(environment: string) {
    try {
      const head = await this.prisma.paymentSettingsHead.findUnique({
        where: { environment },
        include: { revision: true },
      });
      return head ? this.snapshot(head.revision) : null;
    } catch {
      throw new ServiceUnavailableException(
        'PAYMENT_SETTINGS_STORAGE_UNAVAILABLE',
      );
    }
  }
  async forAccounts(environment: string) {
    const accounts = await this.prisma.paymentMonitoredAccount.findMany({
      where: { environment },
      orderBy: { createdAt: 'asc' },
    });
    return Promise.all(
      accounts.map(async (account) => {
        const row = await this.prisma.paymentSettingsRevision.findUniqueOrThrow(
          { where: { id: account.latestRevisionId! } },
        );
        return this.snapshot(row);
      }),
    );
  }
  async credentials(
    environment: string,
    gateway: string,
    accountNumber: string,
    now: Date,
  ) {
    const rows = await this.prisma.paymentWebhookCredentialWindow.findMany({
      where: {
        account: {
          environment,
          normalizedGateway: normalizeGateway(gateway),
          accountNumber,
        },
        OR: [{ acceptUntil: null }, { acceptUntil: { gte: now } }],
      },
      include: { revision: true },
    });
    return rows.map((row) => this.snapshot(row.revision));
  }
  async save(
    snapshot: PaymentSettingsSnapshot,
    expectedRevision: number,
    actorId: string,
    legacy: PaymentSettingsSnapshot | null,
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`payment-settings:${snapshot.environment}`}))`;
        let head = await tx.paymentSettingsHead.findUnique({
          where: { environment: snapshot.environment },
        });
        if (!head && legacy) {
          const initial = await this.writeRevision(tx, legacy, 0, 'ENV', null);
          head = await tx.paymentSettingsHead.create({
            data: {
              environment: snapshot.environment,
              revisionId: initial.id,
              version: 0,
            },
          });
          await this.copyLegacyState(
            tx,
            legacy.environment,
            initial.monitoredAccountId,
          );
        }
        if ((head?.version ?? 0) !== expectedRevision)
          throw new ConflictException('SETTINGS_REVISION_CONFLICT');
        const previous = head
          ? this.snapshot(
              await tx.paymentSettingsRevision.findUniqueOrThrow({
                where: { id: head.revisionId },
              }),
            )
          : null;
        const changedFields = (
          [
            'accountNumber',
            'gateway',
            'bankAccountId',
            'authMethod',
            'apiToken',
            'webhookSecret',
            'webhookApiKey',
          ] as const
        ).filter((key) => previous?.[key] !== snapshot[key]);
        const version = expectedRevision + 1;
        const row = await this.writeRevision(
          tx,
          snapshot,
          version,
          'ADMIN',
          actorId,
        );
        if (head) {
          const result = await tx.paymentSettingsHead.updateMany({
            where: {
              environment: snapshot.environment,
              version: expectedRevision,
            },
            data: { version, revisionId: row.id },
          });
          if (result.count !== 1)
            throw new ConflictException('SETTINGS_REVISION_CONFLICT');
        } else
          await tx.paymentSettingsHead.create({
            data: {
              environment: snapshot.environment,
              version,
              revisionId: row.id,
            },
          });
        await tx.auditLog.create({
          data: {
            actorUserId: actorId,
            action: 'PAYMENT_SETTINGS_SAVED',
            resourceName: 'PaymentSettings',
            resourceId: row.id,
            clientIp: 'system',
            details: {
              environment: snapshot.environment,
              previousVersion: expectedRevision,
              version,
              changedFields,
            },
          },
        });
        return this.snapshot(row);
      });
    } catch (error) {
      if (
        error instanceof ConflictException ||
        error instanceof ServiceUnavailableException
      )
        throw error;
      throw new ServiceUnavailableException('PAYMENT_SETTINGS_SAVE_FAILED');
    }
  }
  async bootstrap(snapshot: PaymentSettingsSnapshot) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`payment-settings:${snapshot.environment}`}))`;
      const head = await tx.paymentSettingsHead.findUnique({
        where: { environment: snapshot.environment },
        include: { revision: true },
      });
      if (head) return this.snapshot(head.revision);
      const row = await this.writeRevision(tx, snapshot, 0, 'ENV', null);
      await tx.paymentSettingsHead.create({
        data: {
          environment: snapshot.environment,
          revisionId: row.id,
          version: 0,
        },
      });
      await this.copyLegacyState(
        tx,
        snapshot.environment,
        row.monitoredAccountId,
      );
      return this.snapshot(row);
    });
  }
  private async copyLegacyState(
    tx: Prisma.TransactionClient,
    environment: string,
    monitoredAccountId: string,
  ) {
    const state = await tx.sePayReconciliationState.findUnique({
      where: { environment },
    });
    await tx.paymentAccountReconciliationState.upsert({
      where: {
        environment_monitoredAccountId: { environment, monitoredAccountId },
      },
      create: {
        environment,
        monitoredAccountId,
        cursor: state?.cursor,
        lastSuccessfulAt: state?.lastSuccessfulAt,
        lastRunId: state?.lastRunId,
      },
      update: {},
    });
  }
  private async writeRevision(
    tx: Prisma.TransactionClient,
    snapshot: PaymentSettingsSnapshot,
    version: number,
    source: string,
    createdBy: string | null,
  ) {
    const {
      environment,
      accountNumber,
      gateway,
      bankAccountId,
      authMethod,
      apiToken,
      webhookSecret,
      webhookApiKey,
    } = snapshot;
    const encryptedSecrets = this.crypto.encrypt(
      JSON.stringify({ apiToken, webhookSecret, webhookApiKey }),
    );
    const identity = {
      environment,
      normalizedGateway: normalizeGateway(gateway),
      accountNumber,
      bankAccountId,
    };
    const account = await tx.paymentMonitoredAccount.upsert({
      where: {
        environment_normalizedGateway_accountNumber_bankAccountId: identity,
      },
      create: identity,
      update: {},
    });
    const previous = account.latestRevisionId
      ? await tx.paymentSettingsRevision.findUniqueOrThrow({
          where: { id: account.latestRevisionId },
        })
      : null;
    const row = await tx.paymentSettingsRevision.create({
      data: {
        environment,
        version,
        source,
        monitoredAccountId: account.id,
        accountNumber,
        gateway,
        bankAccountId,
        authMethod,
        encryptedSecrets: encryptedSecrets as unknown as Prisma.InputJsonValue,
        createdBy,
      },
    });
    const old = previous ? this.snapshot(previous) : null;
    const currentSecret = authMethod === 'hmac' ? webhookSecret : webhookApiKey;
    const oldSecret =
      old?.authMethod === 'hmac' ? old.webhookSecret : old?.webhookApiKey;
    if (!old || old.authMethod !== authMethod || oldSecret !== currentSecret) {
      const retiredAt = new Date();
      await tx.paymentWebhookCredentialWindow.updateMany({
        where: { monitoredAccountId: account.id, retiredAt: null },
        data: {
          retiredAt,
          acceptUntil: new Date(retiredAt.getTime() + 86_400_000),
        },
      });
      await tx.paymentWebhookCredentialWindow.create({
        data: {
          monitoredAccountId: account.id,
          revisionId: row.id,
          method: authMethod,
        },
      });
    }
    await tx.paymentMonitoredAccount.update({
      where: { id: account.id },
      data: { latestRevisionId: row.id },
    });
    return row;
  }
}
