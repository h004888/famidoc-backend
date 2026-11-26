import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../core/database/prisma.service';
import { JwtAuthGuard } from '../../../core/auth/jwt-auth.guard';
import { RolesGuard } from '../../../core/auth/roles.guard';
import { PaymentSettingsController } from '../settings/payment-settings.controller';
import { PaymentSettingsService } from '../settings/payment-settings.service';
import { PaymentSettingsCheckService } from '../settings/payment-settings-check.service';
import { PaymentSettingsRepository } from '../settings/payment-settings.repository';
import { PaymentSettingsCrypto } from '../settings/payment-settings.crypto';
import { PaymentConfigurationTestService } from '../settings/payment-configuration-test.service';
import { PaymentsConfig } from '../payments.config';
import { PaymentsClock } from '../payments.clock';
import { SePayApiClient } from '../sepay/sepay-api.client';
import { SePayReconciliationConfig } from '../sepay/sepay-reconciliation.config';
import type { PaymentSettingsSnapshot } from '../settings/payment-settings.dto';

describe('Admin settings HTTP integration', () => {
  let app: INestApplication,
    jwt: JwtService,
    head: PaymentSettingsSnapshot,
    count: number;
  const ids = new Map<string, string>();
  const originalEnv = { ...process.env };
  const api = {
    listTransactions: jest
      .fn()
      .mockResolvedValue({ transactions: [], hasMore: false }),
  };
  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.PAYMENTS_MODE = 'sepay_test';
    process.env.PAYMENT_SETTINGS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString(
      'base64',
    );
    const module = await Test.createTestingModule({
      controllers: [PaymentSettingsController],
      providers: [
        JwtAuthGuard,
        RolesGuard,
        PaymentsConfig,
        PaymentsClock,
        PaymentSettingsService,
        PaymentSettingsCheckService,
        PaymentSettingsCrypto,
        SePayReconciliationConfig,
        {
          provide: JwtService,
          useValue: new JwtService({
            secret: 'fixture-jwt-secret-only',
            signOptions: { expiresIn: '10m' },
          }),
        },
        { provide: SePayApiClient, useValue: api },
        {
          provide: PaymentSettingsRepository,
          useValue: {
            current: jest.fn(async () => head),
            save: jest.fn(async (snapshot: PaymentSettingsSnapshot) => {
              head = { ...snapshot, revision: snapshot.revision + 1 };
              return head;
            }),
          },
        },
        {
          provide: PaymentConfigurationTestService,
          useValue: { create: jest.fn(), get: jest.fn() },
        },
        {
          provide: PrismaService,
          useValue: {
            user: {
              findUnique: jest.fn(async ({ where }) => ({
                id: where.id,
                role: ids.get(where.id),
                status: 'ACTIVE',
              })),
            },
            invoice: { findMany: jest.fn().mockResolvedValue([]) },
            paymentConfigurationCheckWindow: {
              deleteMany: jest.fn(),
              upsert: jest.fn(async () => ({ count: ++count })),
            },
          },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    jwt = module.get(JwtService);
  });
  beforeEach(() => {
    count = 0;
    api.listTransactions.mockClear();
    head = {
      environment: 'TEST',
      revision: 1,
      revisionId: randomUUID(),
      monitoredAccountId: randomUUID(),
      accountNumber: '00123456789',
      gateway: 'MBBank',
      bankAccountId: randomUUID(),
      authMethod: 'hmac',
      apiToken: 'fixture-api-private',
      webhookSecret: 'fixture-hmac-private'.repeat(3),
      ttlMinutes: 15,
    };
  });
  afterAll(async () => {
    await app.close();
    process.env = originalEnv;
  });
  const path = '/api/v1/payments/admin/settings';
  function token(role: string) {
    const id = randomUUID();
    ids.set(id, role);
    return jwt.sign({ sub: id });
  }
  function draft() {
    return {
      environment: 'TEST',
      expectedRevision: head.revision,
      accountNumber: head.accountNumber,
      gateway: head.gateway,
      bankAccountId: head.bankAccountId,
      authMethod: head.authMethod,
    };
  }
  it('GET -> draft check -> unchanged GET -> PATCH -> stale conflict; secrets never enter response', async () => {
    const authorization = `Bearer ${token('ADMIN')}`;
    const before = await request(app.getHttpServer())
      .get(`${path}?environment=TEST`)
      .set('Authorization', authorization)
      .expect(200);
    expect(before.headers['cache-control']).toContain('no-store');
    expect(JSON.stringify(before.body)).not.toContain('fixture-api-private');
    const payload = {
      ...draft(),
      accountNumber: '00987654321',
      apiToken: 'draft-private',
    };
    const check = await request(app.getHttpServer())
      .post(`${path}/check`)
      .set('Authorization', authorization)
      .send(payload)
      .expect(201);
    expect(
      check.body.checks.find(
        (row: { code: string }) => row.code === 'ACCOUNT_MATCH',
      ).status,
    ).toBe('UNVERIFIED');
    expect(api.listTransactions).toHaveBeenCalledWith(
      'TEST',
      expect.objectContaining({ perPage: 1 }),
      expect.objectContaining({ apiToken: 'draft-private' }),
    );
    const after = await request(app.getHttpServer())
      .get(`${path}?environment=TEST`)
      .set('Authorization', authorization)
      .expect(200);
    expect(after.body).toEqual(before.body);
    const saved = await request(app.getHttpServer())
      .patch(path)
      .set('Authorization', authorization)
      .send(payload)
      .expect(200);
    expect(saved.body.revision).toBe(2);
    expect(saved.body.accountNumber).toBe('00987654321');
    expect(JSON.stringify(saved.body)).not.toContain('draft-private');
    await request(app.getHttpServer())
      .patch(path)
      .set('Authorization', authorization)
      .send(payload)
      .expect(409);
  });
  it('limits check across calls and invalid drafts never call the provider', async () => {
    const authorization = `Bearer ${token('ADMIN')}`;
    await request(app.getHttpServer())
      .post(`${path}/check`)
      .set('Authorization', authorization)
      .send({ ...draft(), accountNumber: '123' })
      .expect(400);
    expect(api.listTransactions).not.toHaveBeenCalled();
    for (let index = 0; index < 5; index++)
      await request(app.getHttpServer())
        .post(`${path}/check`)
        .set('Authorization', authorization)
        .send(draft())
        .expect(201);
    await request(app.getHttpServer())
      .post(`${path}/check`)
      .set('Authorization', authorization)
      .send(draft())
      .expect(429);
    expect(api.listTransactions).toHaveBeenCalledTimes(5);
  });
  it.each(['ADMIN', 'FAMILY_REP', 'DOCTOR', 'HEALTHCARE_FACILITY'])(
    'enforces every settings endpoint for %s',
    async (role) => {
      const endpoints = [
        ['get', `${path}?environment=TEST`],
        ['patch', path],
        ['post', `${path}/check`],
        ['post', `${path}/test-sessions`],
        ['get', `${path}/test-sessions/${randomUUID()}`],
      ] as const;
      for (const [method, endpoint] of endpoints) {
        await request(app.getHttpServer())
          [method](endpoint)
          .send({})
          .expect(401);
        if (role !== 'ADMIN')
          await request(app.getHttpServer())
            [method](endpoint)
            .set('Authorization', `Bearer ${token(role)}`)
            .send({})
            .expect(403);
      }
    },
  );
});
