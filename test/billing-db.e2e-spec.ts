import { Prisma } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { createHmac, randomUUID } from 'node:crypto';
import { PrismaService } from '../src/core/database/prisma.service';
import { AppModule } from '../src/app.module';
import { demoIds, seedDemo } from '../prisma/seed';

// Không được chạy bộ này vào DB chia sẻ/VPS. Chỉ DB local có hậu tố _test.
(process.env.RUN_DB_TESTS === '1' ? describe : describe.skip)(
  'PostgreSQL + JWT + API integration',
  () => {
    let app: INestApplication;
    let db: PrismaService;
    let admin: string, family: string, other: string;
    let payment: any;
    const password = 'TestingOnly_Password_2026';
    const notificationId = 'b0000000-0000-4000-8000-000000000004';
    const packageId = '70000000-0000-4000-8000-000000000002';
    async function start() {
      const module = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      app = module.createNestApplication({ rawBody: true });
      app.useGlobalPipes(
        new ValidationPipe({
          transform: true,
          whitelist: true,
          forbidNonWhitelisted: true,
        }),
      );
      await app.init();
      db = app.get(PrismaService);
    }
    async function login(identifier: string) {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ identifier, password })
        .expect(201);
      expect(res.body.user).not.toHaveProperty('passwordHash');
      return `Bearer ${res.body.accessToken}`;
    }
    function webhook(body: object) {
      const raw = JSON.stringify(body);
      const time = String(Math.floor(Date.now() / 1000));
      const signature =
        'sha256=' +
        createHmac('sha256', process.env.SEPAY_WEBHOOK_SECRET!)
          .update(time + '.' + raw)
          .digest('hex');
      return request(app.getHttpServer())
        .post('/api/v1/payments/webhook/vietqr')
        .set('Content-Type', 'application/json')
        .set('x-sepay-timestamp', time)
        .set('x-sepay-signature', signature)
        .send(raw);
    }
    function transfer(overrides: Record<string, unknown> = {}) {
      return {
        id: Math.floor(Math.random() * 1e9),
        gateway: 'TEST_BANK',
        transactionDate: new Date(Date.now() + 7 * 3600000)
          .toISOString()
          .slice(0, 19)
          .replace('T', ' '),
        accountNumber: '0000000000',
        transferType: 'in',
        transferAmount: payment.amountVnd,
        content: payment.transferContent ?? payment.paymentCode,
        code: payment.paymentCode,
        referenceCode: randomUUID(),
        ...overrides,
      };
    }
    beforeAll(async () => {
      const url = new URL(process.env.DATABASE_URL!);
      if (
        !['localhost', '127.0.0.1'].includes(url.hostname) ||
        !url.pathname.endsWith('_test')
      )
        throw new Error('Use only a dedicated local *_test database');
      Object.assign(process.env, {
        NODE_ENV: 'development',
        JWT_SECRET: 'integration-test-jwt-secret-0000000000000000',
        PAYMENTS_MODE: 'simulation',
        PAYMENTS_EXPECTED_ACCOUNT: '0000000000',
        PAYMENTS_EXPECTED_GATEWAY: 'TEST_BANK',
        PAYMENT_REQUEST_TTL_MINUTES: '15',
        SEPAY_WEBHOOK_SECRET: 'integration-test-webhook-secret-0000000000',
      });
      await start();
      const tables = await db.$queryRaw<
        { tablename: string }[]
      >`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
      // Tên bảng lấy từ catalog, quote identifiers; DB test đã được xác minh trước thao tác dọn fixture.
      await db.$executeRawUnsafe(
        'TRUNCATE TABLE ' +
          tables
            .map((t) => '"' + t.tablename.replaceAll('"', '""') + '"')
            .join(',') +
          ' RESTART IDENTITY CASCADE',
      );
      await seedDemo(db, password);
      admin = await login('admin@demo.famidoc.invalid');
      family = await login('family@demo.famidoc.invalid');
      other = await login('family2@demo.famidoc.invalid');
    }, 60000);
    afterAll(async () => {
      await app?.close();
    });

    it('creates exactly 30 business tables and all foreign keys validate', async () => {
      const count = await db.$queryRaw<
        { count: bigint }[]
      >`SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
      expect(Number(count[0].count)).toBe(30);
      const invalid =
        await db.$queryRaw`SELECT conname FROM pg_constraint WHERE NOT convalidated AND connamespace='public'::regnamespace`;
      expect(invalid).toEqual([]);
    });
    it('seed is idempotent and does not duplicate users or contracts', async () => {
      await seedDemo(db, password);
      expect(await db.user.count()).toBe(5);
      expect(await db.medicalContract.count()).toBe(2);
    });
    it('publishes 1/3/12 month packages with the documented prices', async () => {
      const { body } = await request(app.getHttpServer())
        .get('/api/v1/care-packages')
        .expect(200);
      expect(
        body.items
          .map((p: any) => [p.durationMonths, p.priceVnd])
          .sort((a: number[], b: number[]) => a[0] - b[0]),
      ).toEqual([
        [1, 1000000],
        [3, 2850000],
        [12, 13500000],
      ]);
    });
    it('quotes quarter for five/six members without increasing shared quotas', async () => {
      for (const [memberCount, expected] of [
        [5, 3075000],
        [6, 3300000],
      ]) {
        const { body } = await request(app.getHttpServer())
          .post(`/api/v1/care-packages/${packageId}/quote`)
          .send({ memberCount })
          .expect(200);
        expect(body.pricing.totalPriceVnd).toBe(expected);
        expect(body.benefits.quotas).toMatchObject({
          videoConsultations: 20,
          homeVisits: 3,
        });
      }
      await request(app.getHttpServer())
        .post(`/api/v1/care-packages/${packageId}/quote`)
        .send({ memberCount: 7 })
        .expect(400);
    });
    it('requires ADMIN JWT for package administration and blocks dev-key bypass', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/admin/care-packages')
        .expect(401);
      await request(app.getHttpServer())
        .get('/api/v1/admin/care-packages')
        .set('x-care-packages-dev-key', 'test-only-key')
        .expect(401);
      await request(app.getHttpServer())
        .get('/api/v1/admin/care-packages')
        .set('Authorization', family)
        .expect(403);
      await request(app.getHttpServer())
        .get('/api/v1/admin/care-packages')
        .set('Authorization', admin)
        .expect(200);
    });
    it('versioning preserves previously signed contract prices', async () => {
      const { body: draft } = await request(app.getHttpServer())
        .post(`/api/v1/admin/care-packages/${packageId}/versions`)
        .set('Authorization', admin)
        .expect(201);
      await request(app.getHttpServer())
        .patch(`/api/v1/admin/care-packages/${draft.id}`)
        .set('Authorization', admin)
        .send({ priceVnd: 3000000 })
        .expect(200);
      await request(app.getHttpServer())
        .post(`/api/v1/admin/care-packages/${draft.id}/publish`)
        .set('Authorization', admin)
        .expect(201);
      await request(app.getHttpServer())
        .patch(`/api/v1/admin/care-packages/${draft.id}`)
        .set('Authorization', admin)
        .send({ priceVnd: 1 })
        .expect(409);
      const contract = await db.medicalContract.findUniqueOrThrow({
        where: { id: demoIds.pendingContract },
      });
      expect(Number(contract.totalAmount)).toBe(2850000);
    });
    it('GET/PUT own profile never exposes hashes and rejects role/contact changes', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/users/profile')
        .expect(401);
      const { body } = await request(app.getHttpServer())
        .get('/api/v1/users/profile')
        .set('Authorization', family)
        .expect(200);
      expect(body.id).toBe(demoIds.familyUser);
      expect(body).not.toHaveProperty('passwordHash');
      await request(app.getHttpServer())
        .put('/api/v1/users/profile')
        .set('Authorization', family)
        .send({ role: 'ADMIN' })
        .expect(400);
      await request(app.getHttpServer())
        .put('/api/v1/users/profile')
        .set('Authorization', family)
        .send({ phone: '+84999999999' })
        .expect(400);
      await request(app.getHttpServer())
        .put('/api/v1/users/profile')
        .set('Authorization', family)
        .send({})
        .expect(400);
      await request(app.getHttpServer())
        .put('/api/v1/users/profile')
        .set('Authorization', family)
        .send({ fullName: '  DEMO - Updated name  ' })
        .expect(200);
      expect(
        (await db.user.findUniqueOrThrow({ where: { id: demoIds.familyUser } }))
          .fullName,
      ).toBe('DEMO - Updated name');
      expect(
        await db.auditLog.count({
          where: {
            actorUserId: demoIds.familyUser,
            action: 'UPDATE_OWN_PROFILE',
          },
        }),
      ).toBe(1);
    });
    it('notification listing and read updates are private and idempotent', async () => {
      const { body } = await request(app.getHttpServer())
        .get('/api/v1/notifications?unreadOnly=true&limit=1')
        .set('Authorization', family)
        .expect(200);
      expect(body.items).toHaveLength(1);
      expect(body.items[0].userId).toBe(demoIds.familyUser);
      await request(app.getHttpServer())
        .patch(`/api/v1/notifications/${notificationId}/read`)
        .set('Authorization', other)
        .expect(404);
      await request(app.getHttpServer())
        .patch(`/api/v1/notifications/${notificationId}/read`)
        .set('Authorization', family)
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/api/v1/notifications/${notificationId}/read`)
        .set('Authorization', family)
        .expect(200);
      const unread = await request(app.getHttpServer())
        .get('/api/v1/notifications?unreadOnly=true')
        .set('Authorization', family)
        .expect(200);
      expect(unread.body.unreadCount).toBe(0);
      await request(app.getHttpServer())
        .get('/api/v1/notifications?limit=1000')
        .set('Authorization', family)
        .expect(400);
    });
    it('requires ownership and signed conditions before issuing an invoice', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/payments/vietqr')
        .set('Authorization', other)
        .send({ contractId: demoIds.pendingContract })
        .expect(404);
      await request(app.getHttpServer())
        .post('/api/v1/payments/vietqr')
        .set('Authorization', family)
        .send({ contractId: demoIds.pendingContract, amount: 1 })
        .expect(400);
      const saved = await db.contractSignature.findFirstOrThrow({
        where: {
          contractId: demoIds.pendingContract,
          addendumId: null,
          signerRole: 'ADMIN',
        },
      });
      await db.contractSignature.delete({ where: { id: saved.id } });
      await request(app.getHttpServer())
        .post('/api/v1/payments/vietqr')
        .set('Authorization', family)
        .send({ contractId: demoIds.pendingContract })
        .expect(409);
      await db.contractSignature.create({ data: saved });
      const { body } = await request(app.getHttpServer())
        .post('/api/v1/payments/vietqr')
        .set('Authorization', family)
        .send({ contractId: demoIds.pendingContract })
        .expect(201);
      payment = body;
      expect(payment.amountVnd).toBe(2850000);
      expect(payment.paymentCode).toMatch(/^FD[0-9]{6}$/);
      expect(payment.transferContent).toBe(
        `DEMO UPDATED NAME - ${payment.paymentCode}`,
      );
      const storedInvoice = await db.invoice.findUniqueOrThrow({
        where: { id: payment.id },
      });
      expect(storedInvoice.transferContent).toBe(payment.transferContent);
      const payer = await db.user.findUniqueOrThrow({
        where: { id: demoIds.familyUser },
      });
      await db.user.update({
        where: { id: payer.id },
        data: { fullName: 'DEMO - Tên mới' },
      });
      const afterRename = await request(app.getHttpServer())
        .get(`/api/v1/payments/${payment.id}/status`)
        .set('Authorization', family)
        .expect(200);
      expect(afterRename.body.transferContent).toBe(payment.transferContent);
      await db.user.update({
        where: { id: payer.id },
        data: { fullName: payer.fullName },
      });
      expect(
        Date.parse(payment.expiresAt) - Date.parse(payment.createdAt),
      ).toBe(900000);
      const retry = await request(app.getHttpServer())
        .post('/api/v1/payments/vietqr')
        .set('Authorization', family)
        .send({ contractId: demoIds.pendingContract })
        .expect(201);
      expect(retry.body.id).toBe(payment.id);
    });
    it('rejects webhook without valid signature without writing ledger', async () => {
      const count = await db.paymentTransaction.count();
      await request(app.getHttpServer())
        .post('/api/v1/payments/webhook/vietqr')
        .send(transfer())
        .expect(401);
      expect(await db.paymentTransaction.count()).toBe(count);
    });
    it('records mismatched amounts for review without activating or refunding', async () => {
      await webhook(transfer({ id: 900001, transferAmount: 1 })).expect(200);
      const tx = await db.paymentTransaction.findUniqueOrThrow({
        where: {
          environment_gatewayTransactionId: {
            environment: 'TEST',
            gatewayTransactionId: '900001',
          },
        },
      });
      expect(tx.outcome).toBe('REVIEW_REQUIRED');
      expect(tx.reason).toBe('AMOUNT_MISMATCH');
      expect(
        (await db.invoice.findUniqueOrThrow({ where: { id: payment.id } }))
          .paymentStatus,
      ).toBe('PENDING');
    });
    it('duplicate concurrent callbacks record exactly one payment and one activation', async () => {
      const bank = transfer({ id: 900002 });
      const results = await Promise.all([webhook(bank), webhook(bank)]);
      expect(results.map((r) => r.status)).toEqual([200, 200]);
      expect(
        await db.paymentTransaction.count({
          where: { gatewayTransactionId: '900002' },
        }),
      ).toBe(1);
      const invoice = await db.invoice.findUniqueOrThrow({
        where: { id: payment.id },
      });
      expect(invoice.paymentStatus).toBe('PAID');
      expect(invoice.acceptedTransactionId).not.toBeNull();
      const contract = await db.medicalContract.findUniqueOrThrow({
        where: { id: demoIds.pendingContract },
      });
      expect(contract.contractStatus).toBe('ACTIVE');
      expect(Number(contract.totalAmount)).toBe(2850000);
      expect(
        (await db.doctor.findUniqueOrThrow({ where: { id: demoIds.doctor } }))
          .activePanelCount,
      ).toBe(2);
      // Cùng provider ID nhưng khác nội dung phải bị phát hiện, không ghi đè giao dịch.
      await webhook({ ...bank, transferAmount: 5 }).expect(409);
    });
    it('payment status/history require ownership and admin permissions', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/payments/${payment.id}/status`)
        .set('Authorization', other)
        .expect(404);
      const { body } = await request(app.getHttpServer())
        .get(`/api/v1/payments/${payment.id}/status`)
        .set('Authorization', family)
        .expect(200);
      expect(body.status).toBe('PAID');
      await request(app.getHttpServer())
        .get('/api/v1/payments/transactions')
        .set('Authorization', family)
        .expect(403);
      await request(app.getHttpServer())
        .get('/api/v1/payments/transactions')
        .set('Authorization', admin)
        .expect(200);
    });
    it('persists package versions, notifications and payments after application restart', async () => {
      await app.close();
      await start();
      const { body } = await request(app.getHttpServer())
        .get(`/api/v1/payments/${payment.id}/status`)
        .set('Authorization', family)
        .expect(200);
      expect(body.status).toBe('PAID');
      expect(
        (
          await db.notification.findUniqueOrThrow({
            where: { id: notificationId },
          })
        ).isRead,
      ).toBe(true);
      expect(await db.servicePackage.count()).toBe(4);
    });
    it('does not overbook the last doctor panel slot when two families pay concurrently', async () => {
      await db.doctor.update({
        where: { id: demoIds.doctor },
        data: { maxPanelCapacity: 3 },
      });
      const ids: string[] = [];
      const source = await db.medicalContract.findUniqueOrThrow({
        where: { id: demoIds.pendingContract },
      });
      const hash = (
        await db.user.findUniqueOrThrow({ where: { id: demoIds.familyUser } })
      ).passwordHash;
      for (let i = 0; i < 2; i++) {
        const user = await db.user.create({
          data: {
            email: `cap-${randomUUID()}@demo.famidoc.invalid`,
            phone: `+849${Date.now().toString().slice(-7)}${i}`,
            passwordHash: hash,
            fullName: 'DEMO-cap',
            role: 'FAMILY_REP',
            status: 'ACTIVE',
          },
        });
        const unit = await db.familyUnit.create({
          data: {
            representativeUserId: user.id,
            homeAddress: 'DEMO-cap',
            emergencyPhone: user.phone,
          },
        });
        const { id: _id, createdAt: _c, updatedAt: _u, ...terms } = source;
        const c = await db.medicalContract.create({
          data: {
            ...terms,
            legacyMemberIds: source.legacyMemberIds ?? undefined,
            terminationRequests:
              source.terminationRequests as Prisma.InputJsonValue,
            contractNumber: `DEMO-CAP-${i}`,
            familyId: unit.id,
            contractStatus: 'PENDING_PAYMENT',
            billingSnapshot: source.billingSnapshot!,
          },
        });
        for (const [signerRole, signerUserId] of [
          ['FAMILY_REP', user.id],
          ['ADMIN', demoIds.admin],
          ['HEALTHCARE_FACILITY', demoIds.facilityUser],
          ['ASSIGNED_DOCTOR', demoIds.doctorUser],
        ] as const) {
          await db.contractSignature.create({
            data: {
              contractId: c.id,
              signerRole,
              signerUserId,
              signatureHash: 'DEMO-FIXTURE',
              ipAddress: '127.0.0.1',
            },
          });
        }
        const issued = await request(app.getHttpServer())
          .post('/api/v1/payments/vietqr')
          .set('Authorization', admin)
          .send({ contractId: c.id })
          .expect(201);
        ids.push(c.id);
        if (i === 0) payment = issued.body;
        else {
          const first = transfer({ id: 910001 });
          const second = transfer({
            id: 910002,
            content: issued.body.paymentCode,
            code: issued.body.paymentCode,
          });
          const responses = await Promise.all([
            webhook(first),
            webhook(second),
          ]);
          expect(responses.map((r) => r.status)).toEqual([200, 200]);
        }
      }
      expect(
        await db.medicalContract.count({
          where: { id: { in: ids }, contractStatus: 'ACTIVE' },
        }),
      ).toBe(1);
      expect(
        (await db.doctor.findUniqueOrThrow({ where: { id: demoIds.doctor } }))
          .activePanelCount,
      ).toBe(3);
      // Giao dịch thứ hai vẫn PAID và chờ xử lý, không mất sổ tiền, không tự hoàn tiền.
      expect(
        await db.invoice.count({
          where: { contractId: { in: ids }, paymentStatus: 'PAID' },
        }),
      ).toBe(2);
    });
    it('logout revokes the JWT for subsequent protected requests', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Authorization', family)
        .expect(201);
      await request(app.getHttpServer())
        .get('/api/v1/users/profile')
        .set('Authorization', family)
        .expect(401);
    });
  },
);
