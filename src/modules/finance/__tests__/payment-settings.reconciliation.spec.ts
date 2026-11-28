import { ConflictException } from '@nestjs/common';

type PaymentEnvironment = 'TEST' | 'LIVE';
type TransactionOutcome = string;
import { SePayReconciliationService } from '../services/sepay-reconciliation.service';
import { SePayReconciliationConfig } from '../../payments/sepay/sepay-reconciliation.config';
import { PaymentsConfig } from '../../payments/payments.config';
import type { SePayApiClient } from '../../payments/sepay/sepay-api.client';
import type { IPaymentsService } from '../../payments/services/interfaces/payments.service.interface';
import type { PaymentSettingsService } from '../../payments/settings/payment-settings.service';
import type { PaymentSettingsSnapshot } from '../../payments/settings/payment-settings.dto';

function makeSnapshot(
  overrides: Partial<PaymentSettingsSnapshot> = {},
): PaymentSettingsSnapshot {
  return {
    environment: 'TEST' as PaymentEnvironment,
    revision: 1,
    revisionId: 'rev-1',
    monitoredAccountId: 'acc-a',
    accountNumber: '00123456789',
    gateway: 'MBBank',
    bankAccountId: '11111111-1111-4111-8111-111111111111',
    authMethod: 'hmac',
    apiToken: 'token-a',
    webhookSecret: 's'.repeat(32),
    ttlMinutes: 15,
    ...overrides,
  };
}

function createHarness(
  accounts: PaymentSettingsSnapshot[],
  initialCursors: Record<string, string | null> = {},
) {
  const states = new Map<
    string,
    {
      environment: PaymentEnvironment;
      monitoredAccountId: string;
      cursor: string | null;
      lockedUntil: Date | null;
      leaseOwner: string | null;
      lastRunId: string | null;
      lastSuccessfulAt: Date | null;
    }
  >();

  for (const acc of accounts) {
    const id = acc.monitoredAccountId!;
    states.set(id, {
      environment: acc.environment,
      monitoredAccountId: id,
      cursor: initialCursors[id] ?? null,
      lockedUntil: null,
      leaseOwner: null,
      lastRunId: null,
      lastSuccessfulAt: null,
    });
  }

  let runCounter = 0;
  const runs = new Map<string, Record<string, unknown>>();
  const batches = new Map<string, Record<string, unknown>>();
  const localOnlyCalls: unknown[] = [];

  const txClient = {
    paymentAccountReconciliationState: {
      updateMany: jest.fn(async ({ where, data }) => {
        const s = states.get(where.monitoredAccountId);
        if (!s) return { count: 0 };
        if (where.leaseOwner && s.leaseOwner !== where.leaseOwner) {
          return { count: 0 };
        }
        if (
          where.lockedUntil?.gt &&
          (!s.lockedUntil || s.lockedUntil <= where.lockedUntil.gt)
        ) {
          return { count: 0 };
        }
        Object.assign(s, data);
        return { count: 1 };
      }),
    },
    sePayReconciliationRun: {
      update: jest.fn(async ({ where, data }) => {
        const existing = runs.get(where.id) ?? { id: where.id };
        const updated = { ...existing, ...data };
        runs.set(where.id, updated);
        return updated;
      }),
    },
  };

  const prisma = {
    paymentReconciliationBatch: {
      create: jest.fn(async ({ data }) => {
        const batch = { id: 'batch-1', ...data };
        batches.set(batch.id, batch);
        return batch;
      }),
      update: jest.fn(async ({ where, data }) => {
        const existing = batches.get(where.id) ?? { id: where.id };
        const updated = { ...existing, ...data };
        batches.set(where.id, updated);
        return updated;
      }),
    },
    sePayReconciliationRun: {
      create: jest.fn(async ({ data }) => {
        const id = `run-${++runCounter}`;
        const run = { id, ...data };
        runs.set(id, run);
        return run;
      }),
      update: jest.fn(async ({ where, data }) => {
        const existing = runs.get(where.id) ?? { id: where.id };
        const updated = { ...existing, ...data };
        runs.set(where.id, updated);
        return updated;
      }),
    },
    paymentAccountReconciliationState: {
      upsert: jest.fn(async ({ where, create }) => {
        const id = where.environment_monitoredAccountId.monitoredAccountId;
        if (!states.has(id)) {
          states.set(id, {
            environment: create.environment,
            monitoredAccountId: id,
            cursor: null,
            lockedUntil: null,
            leaseOwner: null,
            lastRunId: null,
            lastSuccessfulAt: null,
          });
        }
        return states.get(id);
      }),
      updateMany: jest.fn(async ({ where, data }) => {
        const s = states.get(where.monitoredAccountId);
        if (!s) return { count: 0 };
        if (where.leaseOwner && s.leaseOwner !== where.leaseOwner) {
          return { count: 0 };
        }
        if (where.OR) {
          const now = where.OR[1]?.lockedUntil?.lt;
          const unlocked =
            s.lockedUntil === null || (now && s.lockedUntil < now);
          if (!unlocked) return { count: 0 };
        }
        if (
          where.lockedUntil?.gt &&
          (!s.lockedUntil || s.lockedUntil <= where.lockedUntil.gt)
        ) {
          return { count: 0 };
        }
        Object.assign(s, data);
        return { count: 1 };
      }),
      findUniqueOrThrow: jest.fn(async ({ where }) => {
        const s = states.get(where.environment_monitoredAccountId.monitoredAccountId);
        if (!s) throw new Error('State not found');
        return { ...s };
      }),
    },
    paymentTransaction: {
      count: jest.fn(async (args) => {
        localOnlyCalls.push(args);
        return 0;
      }),
    },
    $transaction: jest.fn(async (fn) => fn(txClient)),
  };

  const api = {
    listTransactions: jest.fn(
      async (
        _env?: any,
        _query?: any,
      ): Promise<{ transactions: any[]; currentPage: number; hasMore: boolean }> => ({
        transactions: [],
        currentPage: 1,
        hasMore: false,
      }),
    ),
  };

  const payments = {
    handleSePayApiTransaction: jest.fn(async () => ({
      duplicate: false,
      linked: true,
      testOnly: false,
      transaction: { outcome: 'MATCHED' as TransactionOutcome },
    })),
  };

  const settings = {
    repository: {
      forAccounts: jest.fn(async () => accounts),
      current: jest.fn(async () => accounts[accounts.length - 1] ?? null),
    },
  };

  const prevMode = process.env.PAYMENTS_MODE;
  const prevNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  process.env.PAYMENTS_MODE = 'simulation';

  const service = new SePayReconciliationService(
    prisma as never,
    api as unknown as SePayApiClient,
    new SePayReconciliationConfig(),
    new PaymentsConfig(),
    payments as unknown as IPaymentsService,
    settings as unknown as PaymentSettingsService,
  );

  const restoreEnv = () => {
    process.env.PAYMENTS_MODE = prevMode;
    process.env.NODE_ENV = prevNodeEnv;
  };

  return {
    service,
    prisma,
    states,
    api,
    payments,
    settings,
    localOnlyCalls,
    restoreEnv,
  };
}

describe('Payment settings per-account reconciliation', () => {
  it('keeps separate cursors for account A and B, scans both, and does not reset cursor on token rotation', async () => {
    const accA = makeSnapshot({
      monitoredAccountId: 'acc-a',
      accountNumber: '00111111111',
      bankAccountId: '11111111-1111-4111-8111-111111111111',
      apiToken: 'token-a-rotated',
    });
    const accB = makeSnapshot({
      monitoredAccountId: 'acc-b',
      accountNumber: '00222222222',
      bankAccountId: '22222222-2222-4222-8222-222222222222',
      apiToken: 'token-b',
    });
    const h = createHarness([accA, accB], { 'acc-a': 'cursor-a-10', 'acc-b': null });
    try {
      h.api.listTransactions.mockImplementation(async (_env, query) => {
        if (query.bankAccountId === accB.bankAccountId) {
          return {
            transactions: [
              {
                id: 'tx-b-1',
                account_number: accB.accountNumber,
                bank_account_id: accB.bankAccountId,
                bank_brand_name: accB.gateway,
              },
            ],
            currentPage: 1,
            hasMore: false,
          };
        }
        return { transactions: [], currentPage: 1, hasMore: false };
      });

      const batch = (await h.service.runManual(
        { id: 'admin-1', role: 'ADMIN' },
        { environment: 'TEST' },
      )) as any;

      expect(batch.status).toBe('SUCCEEDED');
      expect(h.api.listTransactions).toHaveBeenNthCalledWith(
        1,
        'TEST',
        expect.objectContaining({
          bankAccountId: accA.bankAccountId,
          sinceId: 'cursor-a-10',
        }),
        { apiToken: 'token-a-rotated' },
      );
      expect(h.api.listTransactions).toHaveBeenNthCalledWith(
        2,
        'TEST',
        expect.objectContaining({
          bankAccountId: accB.bankAccountId,
          sinceId: undefined,
        }),
        { apiToken: 'token-b' },
      );
      expect(h.states.get('acc-a')?.cursor).toBe('cursor-a-10');
      expect(h.states.get('acc-b')?.cursor).toBe('tx-b-1');
    } finally {
      h.restoreEnv();
    }
  });

  it('isolates failure on account A so account B still completes and returns PARTIAL', async () => {
    const accA = makeSnapshot({ monitoredAccountId: 'acc-a' });
    const accB = makeSnapshot({
      monitoredAccountId: 'acc-b',
      accountNumber: '00222222222',
      bankAccountId: '22222222-2222-4222-8222-222222222222',
      apiToken: 'token-b',
    });
    const h = createHarness([accA, accB]);
    try {
      h.api.listTransactions.mockImplementation(async (_env, query) => {
        if (query.bankAccountId === accA.bankAccountId) {
          throw new Error('provider down for A');
        }
        return { transactions: [], currentPage: 1, hasMore: false };
      });

      const batch = (await h.service.runScheduled()) as any;
      expect(batch.status).toBe('PARTIAL');
      expect(h.api.listTransactions).toHaveBeenCalledTimes(2);
      expect(batch.runs[0].status).toBe('FAILED');
      expect(batch.runs[1].status).toBe('SUCCEEDED');
    } finally {
      h.restoreEnv();
    }
  });

  it('prevents concurrent workers from entering the same locked account', async () => {
    const accA = makeSnapshot({ monitoredAccountId: 'acc-a' });
    const h = createHarness([accA]);
    try {
      const stateA = h.states.get('acc-a')!;
      stateA.leaseOwner = 'other-worker';
      stateA.lockedUntil = new Date(Date.now() + 600_000);

      const batch = (await h.service.runManual(
        { id: 'admin-1', role: 'ADMIN' },
        { environment: 'TEST' },
      )) as any;

      expect(batch.status).toBe('FAILED');
      expect(h.api.listTransactions).not.toHaveBeenCalled();
      expect(stateA.leaseOwner).toBe('other-worker');
    } finally {
      h.restoreEnv();
    }
  });

  it('filters localOnlyCount by accountNumber and gateway and does not advance cursor on explicit range', async () => {
    const accA = makeSnapshot({
      monitoredAccountId: 'acc-a',
      accountNumber: '00123456789',
      gateway: 'MBBank',
    });
    const h = createHarness([accA], { 'acc-a': 'cursor-before' });
    try {
      h.api.listTransactions.mockResolvedValue({
        transactions: [
          {
            id: 'tx-range-1',
            account_number: accA.accountNumber,
            bank_account_id: accA.bankAccountId,
            bank_brand_name: accA.gateway,
          },
        ],
        currentPage: 1,
        hasMore: false,
      });

      const from = new Date(Date.now() - 7200_000).toISOString();
      const to = new Date(Date.now() - 3600_000).toISOString();
      const batch = await h.service.runManual(
        { id: 'admin-1', role: 'ADMIN' },
        { environment: 'TEST', from, to },
      );

      expect(batch.status).toBe('SUCCEEDED');
      expect(h.states.get('acc-a')?.cursor).toBe('cursor-before');
      expect(h.localOnlyCalls).toHaveLength(1);
      expect(h.localOnlyCalls[0]).toEqual({
        where: expect.objectContaining({
          environment: 'TEST',
          accountNumber: accA.accountNumber,
          gateway: { equals: accA.gateway, mode: 'insensitive' },
          sepayApiTransactionId: null,
        }),
      });
    } finally {
      h.restoreEnv();
    }
  });

  it('renews lease via heartbeat and refuses cursor commit or unlock if lease ownership was lost', async () => {
    const accA = makeSnapshot({ monitoredAccountId: 'acc-a' });
    const h = createHarness([accA], { 'acc-a': 'cursor-old' });
    try {
      h.api.listTransactions.mockImplementation(async () => {
        const s = h.states.get('acc-a')!;
        s.leaseOwner = 'new-owner';
        s.lockedUntil = new Date(Date.now() + 1800_000);
        return {
          transactions: [
            {
              id: 'tx-new',
              account_number: accA.accountNumber,
              bank_account_id: accA.bankAccountId,
              bank_brand_name: accA.gateway,
            },
          ],
          currentPage: 1,
          hasMore: false,
        };
      });

      const batch = (await h.service.runManual(
        { id: 'admin-1', role: 'ADMIN' },
        { environment: 'TEST' },
      )) as any;

      expect(batch.status).toBe('FAILED');
      expect(h.states.get('acc-a')?.cursor).toBe('cursor-old');
      expect(h.states.get('acc-a')?.leaseOwner).toBe('new-owner');
    } finally {
      h.restoreEnv();
    }
  });

  it('excludes testOnly transactions from business reconciliation counts', async () => {
    const accA = makeSnapshot({ monitoredAccountId: 'acc-a' });
    const h = createHarness([accA]);
    try {
      h.api.listTransactions.mockResolvedValue({
        transactions: [
          {
            id: 'tx-test-1',
            account_number: accA.accountNumber,
            bank_account_id: accA.bankAccountId,
            bank_brand_name: accA.gateway,
          },
        ],
        currentPage: 1,
        hasMore: false,
      });
      h.payments.handleSePayApiTransaction.mockResolvedValue({
        duplicate: false,
        linked: false,
        testOnly: true,
        transaction: { outcome: 'IGNORED' as TransactionOutcome },
      });

      const batch = (await h.service.runManual(
        { id: 'admin-1', role: 'ADMIN' },
        { environment: 'TEST' },
      )) as any;

      expect(batch.status).toBe('SUCCEEDED');
      expect(batch.fetchedCount).toBe(0);
      expect(batch.backfilledCount).toBe(0);
      expect(batch.matchedCount).toBe(0);
      expect(batch.ignoredCount).toBe(0);
      expect(h.states.get('acc-a')?.cursor).toBe('tx-test-1');
    } finally {
      h.restoreEnv();
    }
  });

  it('throws NO_MONITORED_ACCOUNT when no monitored accounts exist', async () => {
    const h = createHarness([]);
    try {
      await expect(
        h.service.runManual({ id: 'admin-1', role: 'ADMIN' }, { environment: 'TEST' }),
      ).rejects.toThrow(ConflictException);
    } finally {
      h.restoreEnv();
    }
  });
});
