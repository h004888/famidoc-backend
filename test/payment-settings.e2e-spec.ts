import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/core/database/prisma.service';
import { PaymentSettingsCrypto } from '../src/modules/payments/settings/payment-settings.crypto';
import { PaymentSettingsRepository } from '../src/modules/payments/settings/payment-settings.repository';
import type { PaymentSettingsSnapshot } from '../src/modules/payments/settings/payment-settings.dto';
import { PaymentSettingsService } from '../src/modules/payments/settings/payment-settings.service';
import { PaymentsConfig } from '../src/modules/payments/payments.config';
import { SePayReconciliationConfig } from '../src/modules/payments/sepay/sepay-reconciliation.config';
import { PaymentConfigurationTestService } from '../src/modules/payments/settings/payment-configuration-test.service';
import { SePayReconciliationService } from '../src/modules/finance/services/sepay-reconciliation.service';
import { SePayApiClient } from '../src/modules/payments/sepay/sepay-api.client';
import type { IPaymentsService } from '../src/modules/payments/services/interfaces/payments.service.interface';
jest.setTimeout(60_000);

const isolated = /^payment_settings_test_[a-f0-9]{16}$/.test(
  process.env.PAYMENT_SETTINGS_ISOLATED_SCHEMA ?? '',
);
(isolated ? describe : describe.skip)(
  'Payment settings PostgreSQL integration',
  () => {
    const prisma = new PrismaService();
    const repository = new PaymentSettingsRepository(
      prisma,
      new PaymentSettingsCrypto(),
    );
    const settings = new PaymentSettingsService(
      repository,
      new PaymentsConfig(),
      new SePayReconciliationConfig(),
    );
    let actorId: string;
    const initial: PaymentSettingsSnapshot = {
      environment: 'TEST',
      revision: 0,
      revisionId: null,
      monitoredAccountId: null,
      accountNumber: '00123456789',
      gateway: 'MBBank',
      bankAccountId: randomUUID(),
      authMethod: 'hmac',
      apiToken: 'fixture-token',
      webhookSecret: 's'.repeat(32),
      ttlMinutes: 15,
    };
    const prevPaymentsMode = process.env.PAYMENTS_MODE;
    afterAll(async () => {
      process.env.PAYMENTS_MODE = prevPaymentsMode;
      await prisma.$disconnect();
    });
    beforeAll(async () => {
      process.env.PAYMENTS_MODE = 'sepay_test';
      actorId = (
        await prisma.user.create({
          data: {
            phone: '0900000001',
            email: 'payment-test@example.invalid',
            passwordHash: 'fixture-only',
            role: 'ADMIN',
            fullName: 'Payment Test',
          },
        })
      ).id;
    });
    it('expand preserves legacy writer and bootstrap copies cursor exactly once', async () => {
      const cursor = randomUUID();
      await prisma.sePayReconciliationState.upsert({
        where: { environment: 'TEST' },
        create: { environment: 'TEST', cursor },
        update: { cursor },
      });
      const snapshot = await repository.bootstrap(initial);
      const key = {
        environment: 'TEST',
        monitoredAccountId: snapshot.monitoredAccountId!,
      };
      expect(
        (
          await prisma.paymentAccountReconciliationState.findUniqueOrThrow({
            where: { environment_monitoredAccountId: key },
          })
        ).cursor,
      ).toBe(cursor);
      const advanced = randomUUID();
      await prisma.paymentAccountReconciliationState.update({
        where: { environment_monitoredAccountId: key },
        data: { cursor: advanced },
      });
      await repository.bootstrap(initial);
      expect(
        (
          await prisma.paymentAccountReconciliationState.findUniqueOrThrow({
            where: { environment_monitoredAccountId: key },
          })
        ).cursor,
      ).toBe(advanced);
      const restarted = new PaymentSettingsRepository(
        prisma,
        new PaymentSettingsCrypto(),
      );
      expect((await restarted.current('TEST'))?.apiToken).toBe(
        initial.apiToken,
      );
      const row = await prisma.paymentSettingsRevision.findFirstOrThrow();
      expect(JSON.stringify(row.encryptedSecrets)).not.toContain(
        initial.apiToken,
      );
    });
    it('database unique environment/version and account identity reject duplicates', async () => {
      const row = await prisma.paymentSettingsRevision.findFirstOrThrow();
      await expect(
        prisma.paymentSettingsRevision.create({
          data: { ...row, id: randomUUID() },
        }),
      ).rejects.toThrow();
      const account = await prisma.paymentMonitoredAccount.findFirstOrThrow();
      await expect(
        prisma.paymentMonitoredAccount.create({
          data: { ...account, id: randomUUID() },
        }),
      ).rejects.toThrow();
    });
    it('serializes competing CAS saves and audits only the winning version', async () => {
      const current = (await repository.current('TEST'))!;
      const results = await Promise.allSettled([
        repository.save(current, 0, actorId, null),
        repository.save(current, 0, actorId, null),
      ]);
      expect(
        results.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(1);
      expect(
        results.filter((result) => result.status === 'rejected'),
      ).toHaveLength(1);
      expect(
        await prisma.auditLog.count({
          where: { action: 'PAYMENT_SETTINGS_SAVED' },
        }),
      ).toBe(1);
      expect((await repository.current('TEST'))?.revision).toBe(1);
    });
    it('keeps every retired key until its own deadline and token changes do not extend windows', async () => {
      let current = (await repository.current('TEST'))!;
      current = await repository.save(
        { ...current, webhookSecret: 'K2'.repeat(32) },
        current.revision,
        actorId,
        null,
      );
      const first =
        await prisma.paymentWebhookCredentialWindow.findFirstOrThrow({
          where: { retiredAt: { not: null } },
        });
      current = await repository.save(
        { ...current, webhookSecret: 'K3'.repeat(32) },
        current.revision,
        actorId,
        null,
      );
      current = await repository.save(
        { ...current, apiToken: 'replacement-token' },
        current.revision,
        actorId,
        null,
      );
      const credentials = await repository.credentials(
        'TEST',
        ' MBBANK ',
        initial.accountNumber,
        new Date(),
      );
      expect(credentials).toHaveLength(3);
      expect(new Set(credentials.map((row) => row.webhookSecret)).size).toBe(3);
      expect(
        (
          await prisma.paymentWebhookCredentialWindow.findUniqueOrThrow({
            where: { id: first.id },
          })
        ).acceptUntil,
      ).toEqual(first.acceptUntil);
      await prisma.paymentWebhookCredentialWindow.update({
        where: { id: first.id },
        data: { acceptUntil: new Date(Date.now() - 1) },
      });
      expect(
        await repository.credentials(
          'TEST',
          'MBBank',
          initial.accountNumber,
          new Date(),
        ),
      ).toHaveLength(2);
      expect(
        await repository.credentials(
          'LIVE',
          'MBBank',
          initial.accountNumber,
          new Date(),
        ),
      ).toHaveLength(0);
      expect(
        await repository.credentials('TEST', 'MBBank', '999999', new Date()),
      ).toHaveLength(0);
    });
    it('isolates concurrent sessions/deliveries and permits late webhook only within final deadline', async () => {
      let now = new Date();
      const tests = new PaymentConfigurationTestService(prisma, settings, {
        now: () => now,
      });
      const current = (await repository.current('TEST'))!;
      const dto = {
        environment: 'TEST' as const,
        revision: current.revision,
        requestId: randomUUID(),
        amountVnd: 1000,
      };
      const otherRequestId = randomUUID();
      const sessions = await Promise.all([
        tests.create(dto, actorId),
        tests.create(dto, actorId),
        tests.create({ ...dto, requestId: otherRequestId }, actorId),
      ]);
      expect(new Set(sessions.map((row) => row.id)).size).toBe(1);
      const session = sessions[0];
      expect(session.code).not.toContain('FD');
      const before = await Promise.all([
        prisma.invoice.count(),
        prisma.paymentTransaction.count(),
        prisma.medicalContract.count(),
      ]);
      const incoming = {
        environment: 'TEST' as const,
        source: 'SEPAY_API' as const,
        providerTransactionId: randomUUID(),
        accountNumber: current.accountNumber,
        gateway: current.gateway,
        bankAccountId: current.bankAccountId,
        amountVnd: 1000,
        text: session.code,
        transactionAt: new Date(session.createdAt),
        transferType: 'in',
      };
      await tests.dispatch(incoming);
      expect((await tests.get(session.id, actorId)).observation).toBe(
        'API_SEEN_WEBHOOK_PENDING',
      );
      expect((await tests.get(session.id, actorId)).status).toBe('PENDING');
      now = new Date(+session.expiresAt + 1);
      expect((await tests.get(session.id, actorId)).status).toBe(
        'WAITING_WEBHOOK',
      );
      const webhook = {
        ...incoming,
        source: 'WEBHOOK' as const,
        providerTransactionId: randomUUID(),
        verified: {
          environment: 'TEST' as const,
          monitoredAccountIds: [current.monitoredAccountId!],
        },
      };
      await tests.dispatch({
        ...webhook,
        amountVnd: 999,
        providerTransactionId: randomUUID(),
      });
      await tests.dispatch({
        ...webhook,
        text: `${session.code} FDABC123`,
        providerTransactionId: randomUUID(),
      });
      expect((await tests.get(session.id, actorId)).status).toBe(
        'WAITING_WEBHOOK',
      );
      await Promise.all([
        tests.dispatch(webhook),
        tests.dispatch(webhook),
        tests.get(session.id, actorId),
      ]);
      expect((await tests.get(session.id, actorId)).status).toBe('SUCCEEDED');
      expect(
        (await tests.create({ ...dto, requestId: otherRequestId }, actorId)).id,
      ).toBe(session.id);
      expect(
        await prisma.paymentConfigurationTestDelivery.count({
          where: {
            source: 'WEBHOOK',
            providerTransactionId: webhook.providerTransactionId,
          },
        }),
      ).toBe(1);
      expect(
        await Promise.all([
          prisma.invoice.count(),
          prisma.paymentTransaction.count(),
          prisma.medicalContract.count(),
        ]),
      ).toEqual(before);
      const second = await tests.create(
        { ...dto, requestId: randomUUID() },
        actorId,
      );
      now = new Date(+second.finalizeAt + 1);
      await tests.dispatch({
        ...webhook,
        text: second.code,
        transactionAt: second.createdAt,
        providerTransactionId: randomUUID(),
      });
      expect((await tests.get(second.id, actorId)).status).toBe('EXPIRED');
      await tests.dispatch({
        ...webhook,
        text: 'PTC' + '0'.repeat(24),
        providerTransactionId: randomUUID(),
      });
      expect(
        await prisma.paymentConfigurationTestDelivery.count({
          where: { sessionId: null },
        }),
      ).toBe(1);
    });
    it('persists linked account runs, isolates account failures and preserves separate cursors', async () => {
      const current = (await repository.current('TEST'))!;
      const b = await repository.save(
        {
          ...current,
          accountNumber: '00987654321',
          bankAccountId: randomUUID(),
        },
        current.revision,
        actorId,
        null,
      );
      const api = {
        listTransactions: jest.fn(async (_environment, query) => {
          if (query.bankAccountId === initial.bankAccountId)
            throw new Error('private provider response');
          return { transactions: [], currentPage: 1, hasMore: false };
        }),
      };
      const service = new SePayReconciliationService(
        prisma,
        api as unknown as SePayApiClient,
        new SePayReconciliationConfig(),
        new PaymentsConfig(),
        {} as IPaymentsService,
        settings,
      );
      const batch = await service.runManual(
        { id: actorId, role: 'ADMIN' },
        { environment: 'TEST' },
      );
      expect(batch).toHaveProperty('resultKind', 'BATCH');
      expect(batch.status).toBe('PARTIAL');
      expect(JSON.stringify(batch)).not.toContain('private provider response');
      const stored = await prisma.paymentReconciliationBatch.findUniqueOrThrow({
        where: { id: batch.id },
        include: { runs: true },
      });
      expect(stored.runs).toHaveLength(2);
      expect(stored.runs.every((run) => run.batchId === stored.id)).toBe(true);
      const bState =
        await prisma.paymentAccountReconciliationState.findUniqueOrThrow({
          where: {
            environment_monitoredAccountId: {
              environment: 'TEST',
              monitoredAccountId: b.monitoredAccountId!,
            },
          },
        });
      expect(bState.cursor).toBeNull();
      expect(bState.lockedUntil).toBeNull();
      expect(api.listTransactions).toHaveBeenCalledTimes(2);
    });
    it('accepts both transaction time boundaries and receivedAt = finalizeAt, rejecting every value outside', async () => {
      const snapshot = (await repository.current('TEST'))!;
      for (const [transactionOffset, receiveOffset, valid] of [
        [-300000, 0, true],
        [-300001, 0, false],
        [1200000, 0, true],
        [1200001, 0, false],
        [0, 87300000, true],
        [0, 87300001, false],
      ] as const) {
        let now = new Date('2026-11-25T10:00:00Z');
        const clock = { now: () => now },
          owner = randomUUID();
        const tests = new PaymentConfigurationTestService(
          prisma,
          settings,
          clock,
        );
        const session = await tests.create(
          {
            environment: 'TEST',
            revision: snapshot.revision,
            requestId: randomUUID(),
            amountVnd: 1000,
          },
          owner,
        );
        const transactionAt = new Date(+now + transactionOffset);
        now = new Date(+now + receiveOffset);
        await tests.dispatch({
          environment: 'TEST',
          source: 'WEBHOOK',
          providerTransactionId: randomUUID(),
          gateway: snapshot.gateway,
          accountNumber: snapshot.accountNumber,
          amountVnd: 1000,
          text: session.code,
          transactionAt,
          transferType: 'in',
          verified: {
            environment: 'TEST',
            monitoredAccountIds: [snapshot.monitoredAccountId!],
          },
        });
        expect(
          (await tests.get(session.id, owner)).status === 'SUCCEEDED',
        ).toBe(valid);
      }
    });
    it('does not commit cursor or release another worker lease after losing ownership', async () => {
      const accounts = await repository.forAccounts('TEST');
      const a = accounts[0],
        otherOwner = randomUUID();
      const key = {
        environment: 'TEST',
        monitoredAccountId: a.monitoredAccountId!,
      };
      const before =
        await prisma.paymentAccountReconciliationState.findUniqueOrThrow({
          where: { environment_monitoredAccountId: key },
        });
      const api = {
        listTransactions: jest.fn(async (_environment, query) => {
          if (query.bankAccountId === a.bankAccountId)
            await prisma.paymentAccountReconciliationState.update({
              where: { environment_monitoredAccountId: key },
              data: {
                leaseOwner: otherOwner,
                lockedUntil: new Date(Date.now() + 1800000),
              },
            });
          return { transactions: [], hasMore: false, currentPage: 1 };
        }),
      };
      const service = new SePayReconciliationService(
        prisma,
        api as unknown as SePayApiClient,
        new SePayReconciliationConfig(),
        new PaymentsConfig(),
        {} as IPaymentsService,
        settings,
      );
      const batch = await service.runManual(
        { id: actorId, role: 'ADMIN' },
        { environment: 'TEST' },
      );
      expect(batch.status).toBe('PARTIAL');
      const after =
        await prisma.paymentAccountReconciliationState.findUniqueOrThrow({
          where: { environment_monitoredAccountId: key },
        });
      expect(after.leaseOwner).toBe(otherOwner);
      expect(after.cursor).toBe(before.cursor);
      await prisma.paymentAccountReconciliationState.update({
        where: { environment_monitoredAccountId: key },
        data: { leaseOwner: null, lockedUntil: null },
      });
    });
    it('two workers never enter the same account concurrently and account B proceeds while A is locked', async () => {
      const accounts = await repository.forAccounts('TEST');
      const a = accounts[0];
      let release!: () => void, entered!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      const firstEntered = new Promise<void>(resolve => { entered = resolve; });
      let first = true;
      const active = new Map<string, number>(), maxima = new Map<string, number>();
      const api = { listTransactions: jest.fn(async (_environment, query, credentials) => {
        const id = query.bankAccountId;
        active.set(id, (active.get(id) ?? 0) + 1); maxima.set(id, Math.max(maxima.get(id) ?? 0, active.get(id)!));
        expect(credentials.apiToken).toBe(accounts.find(account => account.bankAccountId === id)!.apiToken);
        if (first && id === a.bankAccountId) { first = false; entered(); await gate; }
        active.set(id, active.get(id)! - 1);
        return { transactions: [], hasMore: false, currentPage: 1 };
      }) };
      const makeService = () => new SePayReconciliationService(prisma, api as unknown as SePayApiClient, new SePayReconciliationConfig(), new PaymentsConfig(), {} as IPaymentsService, settings);
      const firstRun = makeService().runManual({ id: actorId, role: 'ADMIN' }, { environment: 'TEST' });
      await firstEntered;
      try {
        const second = await makeService().runManual({ id: actorId, role: 'ADMIN' }, { environment: 'TEST' });
        expect(second.status).toBe('PARTIAL');
      } finally { release(); }
      await firstRun;
      expect([...maxima.values()]).toEqual([1, 1]);
    });
  },
);
