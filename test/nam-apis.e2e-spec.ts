import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createHmac, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/database/prisma.service';
import { demoIds, seedDemo } from '../prisma/seed';
import {
  namScenarioIds,
  seedNamApiScenarios,
} from '../prisma/seed-nam-scenarios';

(process.env.RUN_DB_TESTS === '1' ? describe : describe.skip)(
  'Nam: all 16 API workflows on PostgreSQL',
  () => {
    let app: INestApplication, db: PrismaService;
    const tokens: Record<string, string> = {};
    const password = 'TestingOnly_Password_2026';
    let complaintId: string,
      memberAddendumId: string,
      quotaAddendumId: string,
      termination: any,
      upgrade: any;
    let txSequence = 950000;
    const active = demoIds.activeContract;
    const futureMember = '50000000-0000-4000-8000-000000000007';
    async function call(
      method: 'get' | 'post' | 'put' | 'patch',
      path: string,
      who = 'family2',
      body?: object,
      status = 200,
    ) {
      let req = request(app.getHttpServer())[method](path);
      if (tokens[who]) req = req.set('Authorization', tokens[who]);
      if (body) req = req.send(body);
      return req.expect(status);
    }
    async function pay(invoice: any, overrides: Record<string, unknown> = {}) {
      const payload = {
        id: ++txSequence,
        gateway: 'TEST_BANK',
        accountNumber: '0000000000',
        transferType: 'in',
        transferAmount: invoice.amountVnd,
        code: invoice.paymentCode,
        content: invoice.transferContent ?? invoice.paymentCode,
        referenceCode: randomUUID(),
        transactionDate: new Date(Date.now() + 7 * 3600000)
          .toISOString()
          .slice(0, 19)
          .replace('T', ' '),
        ...overrides,
      };
      const raw = JSON.stringify(payload),
        timestamp = String(Math.floor(Date.now() / 1000));
      const signature =
        'sha256=' +
        createHmac('sha256', process.env.SEPAY_WEBHOOK_SECRET!)
          .update(timestamp + '.' + raw)
          .digest('hex');
      const response = await request(app.getHttpServer())
        .post('/api/v1/payments/webhook/vietqr')
        .set('Content-Type', 'application/json')
        .set('x-sepay-timestamp', timestamp)
        .set('x-sepay-signature', signature)
        .send(raw)
        .expect(200);
      return { response, payload };
    }
    async function signAll(addendumId: string, hash: string) {
      for (const who of ['family2', 'admin', 'facility', 'doctor'])
        await call(
          'put',
          `/api/v1/contracts/${active}/addendums/${addendumId}/sign`,
          who,
          { termsHash: hash, acceptedTerms: true },
        );
    }
    beforeAll(async () => {
      const url = new URL(process.env.DATABASE_URL!);
      if (
        !['127.0.0.1', 'localhost'].includes(url.hostname) ||
        !url.pathname.endsWith('_test')
      )
        throw new Error('Only use a dedicated local *_test database');
      Object.assign(process.env, {
        NODE_ENV: 'development',
        JWT_SECRET: 'nam-api-integration-secret-0000000000000000',
        PAYMENTS_MODE: 'simulation',
        PAYMENTS_EXPECTED_ACCOUNT: '0000000000',
        PAYMENTS_EXPECTED_GATEWAY: 'TEST_BANK',
        PAYMENT_REQUEST_TTL_MINUTES: '15',
        SEPAY_WEBHOOK_SECRET: 'nam-webhook-integration-secret-000000000000',
        SEPAY_WEBHOOK_AUTH: 'hmac',
      });
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
      const tables = await db.$queryRaw<
        { tablename: string }[]
      >`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations'`;
      await db.$executeRawUnsafe(
        'TRUNCATE TABLE ' +
          tables
            .map((t) => '"' + t.tablename.replaceAll('"', '""') + '"')
            .join(',') +
          ' RESTART IDENTITY CASCADE',
      );
      await seedDemo(db, password);
      await seedNamApiScenarios(db);
      for (const name of ['admin', 'facility', 'doctor', 'family', 'family2']) {
        const res = await request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .send({ identifier: `${name}@demo.famidoc.invalid`, password })
          .expect(201);
        tokens[name] = 'Bearer ' + res.body.accessToken;
      }
    }, 120000);
    afterAll(async () => {
      await app?.close();
    });
    it('keeps all user/notification APIs private and returns the correct actor', async () => {
      const profile = await call('get', '/api/v1/users/profile');
      expect(profile.body.id).toBe(demoIds.otherUser);
      expect(profile.body.passwordHash).toBeUndefined();
      await call('put', '/api/v1/users/profile', 'family2', {
        fullName: 'DEMO - Nam API test',
      });
      const list = await call('get', '/api/v1/notifications');
      expect(
        list.body.items.every((n: any) => n.userId === demoIds.otherUser),
      ).toBe(true);
      await call(
        'patch',
        '/api/v1/notifications/' + list.body.items[0].id + '/read',
      );
      await call(
        'put',
        '/api/v1/users/profile',
        'family2',
        { role: 'ADMIN' },
        400,
      );
    });
    it('allows one review for a completed encounter of the family', async () => {
      await call(
        'post',
        '/api/v1/reviews/doctors',
        'family2',
        { encounterId: namScenarioIds.pendingEncounter, ratingStars: 5 },
        409,
      );
      await call(
        'post',
        '/api/v1/reviews/doctors',
        'family',
        { encounterId: namScenarioIds.completedEncounter, ratingStars: 5 },
        404,
      );
      await call(
        'post',
        '/api/v1/reviews/doctors',
        'doctor',
        { encounterId: namScenarioIds.completedEncounter, ratingStars: 5 },
        403,
      );
      await call(
        'post',
        '/api/v1/reviews/doctors',
        'family2',
        { encounterId: namScenarioIds.completedEncounter, ratingStars: 6 },
        400,
      );
      await call(
        'post',
        '/api/v1/reviews/doctors',
        'family2',
        {
          encounterId: namScenarioIds.completedEncounter,
          ratingStars: 4,
          reviewComment: 'DEMO - Thái độ và thời gian phù hợp.',
        },
        201,
      );
      await call(
        'post',
        '/api/v1/reviews/doctors',
        'family2',
        { encounterId: namScenarioIds.completedEncounter, ratingStars: 5 },
        409,
      );
      const doctor = await db.doctor.findUniqueOrThrow({
        where: { id: demoIds.doctor },
      });
      expect(doctor.totalReviews).toBe(1);
      expect(Number(doctor.ratingAvg)).toBe(4);
    });
    it('records complaints from both the family and the assigned doctor', async () => {
      await call(
        'post',
        '/api/v1/complaints',
        'family2',
        {
          contractId: active,
          encounterId: randomUUID(),
          category: 'DOCTOR_ABSENT',
          description: 'DEMO - Bác sĩ không đến đúng hẹn.',
        },
        400,
      );
      await call(
        'post',
        '/api/v1/complaints',
        'family2',
        {
          contractId: active,
          category: 'DOCTOR_ABSENT',
          description: 'DEMO - Bác sĩ không đến đúng hẹn.',
          evidenceKeys: ['another-user/complaints/file.pdf'],
        },
        400,
      );
      const item = await call(
        'post',
        '/api/v1/complaints',
        'family2',
        {
          contractId: active,
          encounterId: namScenarioIds.completedEncounter,
          category: 'MISSED_VISIT',
          description: 'DEMO - Cần kiểm tra chất lượng dịch vụ.',
        },
        201,
      );
      complaintId = item.body.id;
      expect(item.body.targetUserId).toBe(demoIds.doctorUser);
      const reverse = await call(
        'post',
        '/api/v1/complaints',
        'doctor',
        {
          contractId: active,
          category: 'FAMILY_UNCOOPERATIVE',
          description: 'DEMO - Gia đình chưa phối hợp lịch hẹn.',
        },
        201,
      );
      expect(reverse.body.targetUserId).toBe(demoIds.otherUser);
    });
    it('restricts complaint detail and requires facility verification before Admin resolution', async () => {
      await call(
        'get',
        '/api/v1/complaints/' + complaintId,
        'family',
        undefined,
        404,
      );
      const detail = await call(
        'get',
        '/api/v1/complaints/' + complaintId,
        'facility',
      );
      expect(detail.body.contract).toBeUndefined();
      expect(detail.body.clinicalEmr).toBeUndefined();
      await call(
        'patch',
        `/api/v1/complaints/${complaintId}/resolve`,
        'admin',
        {
          action: 'RESOLVE',
          outcome: 'NO_VIOLATION',
          notes: 'DEMO - Chưa đủ bước xác minh.',
        },
        409,
      );
      await call(
        'patch',
        `/api/v1/complaints/${complaintId}/resolve`,
        'facility',
        {
          action: 'INVESTIGATE',
          notes: 'DEMO - CSYT không tự bắt đầu thụ lý.',
        },
        403,
      );
      await call(
        'patch',
        `/api/v1/complaints/${complaintId}/resolve`,
        'admin',
        {
          action: 'INVESTIGATE',
          notes: 'DEMO - Tiếp nhận và đề nghị CSYT xác minh.',
        },
      );
      await call(
        'patch',
        `/api/v1/complaints/${complaintId}/resolve`,
        'admin',
        {
          action: 'RESOLVE',
          outcome: 'NO_VIOLATION',
          notes: 'DEMO - CSYT chưa có phản hồi xác minh.',
        },
        409,
      );
      await call(
        'patch',
        `/api/v1/complaints/${complaintId}/resolve`,
        'facility',
        {
          action: 'FACILITY_RESPONSE',
          notes: 'DEMO - Đã đối chiếu lịch và ghi nhận giải trình.',
        },
      );
      await call(
        'patch',
        `/api/v1/complaints/${complaintId}/resolve`,
        'admin',
        {
          action: 'RESOLVE',
          outcome: 'REFUND',
          notes: 'DEMO - Không chấp nhận hoàn tiền.',
        },
        400,
      );
      const resolved = await call(
        'patch',
        `/api/v1/complaints/${complaintId}/resolve`,
        'admin',
        {
          action: 'RESOLVE',
          outcome: 'SERVICE_CORRECTION',
          notes: 'DEMO - Yêu cầu CSYT điều chỉnh quy trình.',
        },
      );
      expect(resolved.body.status).toBe('RESOLVED');
      await call(
        'patch',
        `/api/v1/complaints/${complaintId}/resolve`,
        'admin',
        {
          action: 'CLOSE',
          notes: 'DEMO - Đã thông báo kết quả và đóng phản ánh.',
        },
      );
    });
    it('does not charge again for an unused member place already included in the package', async () => {
      await db.patient.update({
        where: { id: '50000000-0000-4000-8000-000000000006' },
        data: { status: 'ACTIVE' },
      });
      for (const additionalMembers of [0, -1, 6, 1.5]) {
        await call(
          'post',
          `/api/v1/contracts/${active}/addendums`,
          'family2',
          {
            requestKey: randomUUID(),
            type: 'MEMBER_EXTENSION',
            additionalMembers,
          },
          400,
        );
      }
      await call(
        'post',
        `/api/v1/contracts/${active}/addendums`,
        'family2',
        {
          requestKey: randomUUID(),
          type: 'MEMBER_EXTENSION',
          memberIds: [futureMember],
        },
        400,
      );
      const dto = {
        requestKey: randomUUID(),
        type: 'MEMBER_EXTENSION',
        additionalMembers: 1,
      };
      const first = await call(
        'post',
        `/api/v1/contracts/${active}/addendums`,
        'family2',
        dto,
        201,
      );
      expect(Number(first.body.additionalAmount)).toBe(0);
      const retry = await call(
        'post',
        `/api/v1/contracts/${active}/addendums`,
        'family2',
        dto,
        201,
      );
      expect(retry.body.id).toBe(first.body.id);
      await call(
        'put',
        `/api/v1/contracts/${active}/addendums/${first.body.id}/sign`,
        'admin',
        { termsHash: first.body.termsHash, acceptedTerms: true },
        409,
      );
      await signAll(first.body.id, first.body.termsHash);
      expect(
        await db.contractSignature.count({
          where: { contractId: active, addendumId: null },
        }),
      ).toBe(4);
      expect(
        await db.contractSignature.count({
          where: { contractId: active, addendumId: first.body.id },
        }),
      ).toBe(4);
      expect(
        (
          await db.contractAddendum.findUniqueOrThrow({
            where: { id: first.body.id },
          })
        ).status,
      ).toBe('ACTIVE');
      expect(
        (await db.medicalContract.findUniqueOrThrow({ where: { id: active } }))
          .memberCount,
      ).toBe(2);
      expect(
        await db.invoice.count({ where: { addendumId: first.body.id } }),
      ).toBe(0);
    });
    it('charges a signed member addendum and activates it once through the payment webhook', async () => {
      await db.patient.update({
        where: { id: futureMember },
        data: { status: 'ACTIVE' },
      });
      const item = await call(
        'post',
        `/api/v1/contracts/${active}/addendums`,
        'family2',
        {
          requestKey: randomUUID(),
          type: 'MEMBER_EXTENSION',
          additionalMembers: 1,
        },
        201,
      );
      memberAddendumId = item.body.id;
      expect(
        (await db.medicalContract.findUniqueOrThrow({ where: { id: active } }))
          .memberCount,
      ).toBe(2);
      expect(Number(item.body.additionalAmount)).toBe(75000);
      await call(
        'post',
        '/api/v1/payments/vietqr',
        'family2',
        { contractId: active, addendumId: memberAddendumId },
        409,
      );
      await signAll(memberAddendumId, item.body.termsHash);
      const invoice = await call(
        'post',
        '/api/v1/payments/vietqr',
        'family2',
        { contractId: active, addendumId: memberAddendumId },
        201,
      );
      expect(invoice.body.amountVnd).toBe(75000);
      await call(
        'get',
        `/api/v1/payments/${invoice.body.id}/status`,
        'family',
        undefined,
        404,
      );
      await pay(invoice.body);
      await pay(invoice.body);
      expect(
        (
          await db.contractAddendum.findUniqueOrThrow({
            where: { id: memberAddendumId },
          })
        ).status,
      ).toBe('ACTIVE');
      expect(
        (await db.medicalContract.findUniqueOrThrow({ where: { id: active } }))
          .memberCount,
      ).toBe(3);
      const parent = await db.medicalContract.findUniqueOrThrow({
        where: { id: active },
      });
      expect(parent.remainingHomeVisits).toBe(1);
      expect(parent.remainingTelehealth).toBe(2);
    });
    it('adds home visits at the frozen package unit price, without selling extra video', async () => {
      await call(
        'post',
        `/api/v1/contracts/${active}/addendums`,
        'family2',
        {
          requestKey: randomUUID(),
          type: 'QUOTA_EXPANSION',
          extraHomeVisits: 2,
          extraTelehealth: 10,
        },
        400,
      );
      const item = await call(
        'post',
        `/api/v1/contracts/${active}/addendums`,
        'family2',
        {
          requestKey: randomUUID(),
          type: 'QUOTA_EXPANSION',
          extraHomeVisits: 2,
        },
        201,
      );
      quotaAddendumId = item.body.id;
      expect(Number(item.body.additionalAmount)).toBe(2000000);
      await signAll(quotaAddendumId, item.body.termsHash);
      const invoice = await call(
        'post',
        '/api/v1/payments/vietqr',
        'family2',
        { contractId: active, addendumId: quotaAddendumId },
        201,
      );
      const { payload } = await pay(invoice.body);
      await pay(invoice.body, payload);
      expect(
        (await db.medicalContract.findUniqueOrThrow({ where: { id: active } }))
          .remainingHomeVisits,
      ).toBe(3);
      expect(
        (await db.doctor.findUniqueOrThrow({ where: { id: demoIds.doctor } }))
          .activePanelCount,
      ).toBe(1);
    });
    it('requires all affected parties and Admin approval before termination, preserving paid records', async () => {
      await call(
        'post',
        `/api/v1/contracts/${active}/upgrade`,
        'family2',
        {
          packageId: '70000000-0000-4000-8000-000000000002',
        },
        409,
      );
      const invoicesBefore = await db.invoice.count({
        where: { contractId: active, paymentStatus: 'PAID' },
      });
      await db.clinicalEmr.create({
        data: {
          encounterId: namScenarioIds.completedEncounter,
          chiefComplaint: 'DEMO',
          clinicalFindings: 'DEMO',
          icd10Code: 'Z00',
          icd10Diagnosis: 'DEMO',
          treatmentPlan: 'DEMO',
          isFinalized: true,
        },
      });
      const rejected = await call(
        'patch',
        `/api/v1/contracts/${active}/terminate`,
        'family2',
        {
          action: 'REQUEST',
          reason: 'DEMO - Yêu cầu đầu tiên cần xem xét lại điều khoản.',
        },
      );
      await call('patch', `/api/v1/contracts/${active}/terminate`, 'admin', {
        action: 'REJECT',
        requestId: rejected.body.id,
        reason: 'DEMO - Chưa thống nhất điều kiện chấm dứt dịch vụ.',
      });
      const item = await call(
        'patch',
        `/api/v1/contracts/${active}/terminate`,
        'family2',
        {
          action: 'REQUEST',
          reason: 'DEMO - Các bên thống nhất kết thúc dịch vụ trước hạn.',
        },
      );
      const history = (
        await db.medicalContract.findUniqueOrThrow({ where: { id: active } })
      ).terminationRequests as unknown as { id: string; status: string }[];
      expect(history).toHaveLength(2);
      expect(history.find((r) => r.id === rejected.body.id)?.status).toBe(
        'REJECTED',
      );
      expect(history.find((r) => r.id === item.body.id)?.status).toBe(
        'PENDING',
      );
      termination = item.body;
      await call(
        'patch',
        `/api/v1/contracts/${active}/terminate`,
        'admin',
        {
          action: 'APPROVE',
          requestId: termination.id,
          termsHash: termination.termsHash,
        },
        409,
      );
      for (const who of ['facility', 'doctor'])
        await call('patch', `/api/v1/contracts/${active}/terminate`, who, {
          action: 'CONSENT',
          requestId: termination.id,
          termsHash: termination.termsHash,
        });
      await db.encounter.update({
        where: { id: namScenarioIds.pendingEncounter },
        data: { encounterStatus: 'IN_PROGRESS' },
      });
      await call(
        'patch',
        `/api/v1/contracts/${active}/terminate`,
        'admin',
        {
          action: 'APPROVE',
          requestId: termination.id,
          termsHash: termination.termsHash,
        },
        409,
      );
      await db.encounter.update({
        where: { id: namScenarioIds.pendingEncounter },
        data: { encounterStatus: 'CONFIRMED' },
      });
      const approved = await call(
        'patch',
        `/api/v1/contracts/${active}/terminate`,
        'admin',
        {
          action: 'APPROVE',
          requestId: termination.id,
          termsHash: termination.termsHash,
        },
      );
      expect(approved.body.refundProcessed).toBe(false);
      expect(
        (await db.medicalContract.findUniqueOrThrow({ where: { id: active } }))
          .contractStatus,
      ).toBe('TERMINATED');
      expect(
        (
          await db.encounter.findUniqueOrThrow({
            where: { id: namScenarioIds.pendingEncounter },
          })
        ).encounterStatus,
      ).toBe('CANCELLED');
      expect(
        await db.invoice.count({
          where: { contractId: active, paymentStatus: 'PAID' },
        }),
      ).toBe(invoicesBefore);
      expect(await db.clinicalEmr.count()).toBe(1);
      expect(
        (await db.doctor.findUniqueOrThrow({ where: { id: demoIds.doctor } }))
          .activePanelCount,
      ).toBe(0);
    });
    it('creates an independent upgrade contract, signs it and activates only after payment', async () => {
      const dto = {
        packageId: '70000000-0000-4000-8000-000000000002',
      };
      const created = await call(
        'post',
        `/api/v1/contracts/${active}/upgrade`,
        'family2',
        dto,
        201,
      );
      upgrade = created.body;
      expect(JSON.stringify(upgrade)).not.toContain('passwordHash');
      expect(upgrade.doctor).toBeUndefined();
      expect(upgrade.facility).toBeUndefined();
      expect(upgrade.id).not.toBe(active);
      expect(upgrade.contractStatus).toBe('PENDING_APPROVAL');
      expect(upgrade.upgradedFromId).toBe(active);
      expect(Number(upgrade.totalAmount)).toBe(2850000);
      expect(upgrade.remainingHomeVisits).toBe(3);
      expect(upgrade.remainingTelehealth).toBe(20);
      const retry = await call(
        'post',
        `/api/v1/contracts/${active}/upgrade`,
        'family2',
        dto,
        201,
      );
      expect(retry.body.id).toBe(upgrade.id);
      await call(
        'post',
        '/api/v1/payments/vietqr',
        'family2',
        { contractId: upgrade.id },
        409,
      );
      const terms = await call('get', `/api/v1/contracts/${upgrade.id}/terms`);
      expect(terms.body.signedRoles).toEqual([]);
      for (const who of ['family2', 'admin', 'facility', 'doctor'])
        await call('put', `/api/v1/contracts/${upgrade.id}/sign-upgrade`, who, {
          termsHash: terms.body.termsHash,
          acceptedTerms: true,
        });
      const issued = await call(
        'post',
        '/api/v1/payments/vietqr',
        'family2',
        { contractId: upgrade.id },
        201,
      );
      await pay(issued.body);
      expect(
        (
          await db.medicalContract.findUniqueOrThrow({
            where: { id: upgrade.id },
          })
        ).contractStatus,
      ).toBe('ACTIVE');
      expect(
        await db.medicalContract.count({
          where: { familyId: demoIds.otherFamily, contractStatus: 'ACTIVE' },
        }),
      ).toBe(1);
    });
    it('reports TEST revenue separately and restricts the facility scope', async () => {
      const prev = new Date(Date.now() + 7 * 3600000);
      prev.setUTCDate(1);
      prev.setUTCMonth(prev.getUTCMonth() - 1);
      const query = `year=${prev.getUTCFullYear()}&month=${prev.getUTCMonth() + 1}`;
      await call(
        'get',
        `/api/v1/finance/analytics?${query}&environment=TEST`,
        'family2',
        undefined,
        403,
      );
      const result = await call(
        'get',
        `/api/v1/finance/analytics?${query}&environment=TEST`,
        'admin',
      );
      expect(result.body.grossVnd).toBe(1000000);
      expect(result.body.platformFeeVnd).toBe(150000);
      expect(result.body.facilityShareVnd).toBe(850000);
      const own = await call(
        'get',
        `/api/v1/finance/analytics?${query}&environment=TEST`,
        'facility',
      );
      expect(own.body.facilityId).toBe(demoIds.facility);
      expect(own.body.unmatchedTransactionsCount).toBeUndefined();
      await call(
        'get',
        `/api/v1/finance/analytics?${query}&environment=TEST&facilityId=${randomUUID()}`,
        'facility',
        undefined,
        404,
      );
      const live = await call(
        'get',
        `/api/v1/finance/analytics?${query}&environment=LIVE`,
        'admin',
      );
      expect(live.body.grossVnd).toBe(0);
    });
    it('prepares monthly settlement idempotently, keeps it pending until the transfer is reconciled', async () => {
      const prev = new Date(Date.now() + 7 * 3600000);
      prev.setUTCDate(1);
      prev.setUTCMonth(prev.getUTCMonth() - 1);
      const dto = {
        year: prev.getUTCFullYear(),
        month: prev.getUTCMonth() + 1,
        environment: 'TEST',
      };
      await call(
        'post',
        '/api/v1/finance/settlements/monthly',
        'facility',
        dto,
        403,
      );
      const [first, second] = await Promise.all([
        call('post', '/api/v1/finance/settlements/monthly', 'admin', dto, 201),
        call('post', '/api/v1/finance/settlements/monthly', 'admin', dto, 201),
      ]);
      expect(first.body.settlements).toHaveLength(1);
      expect(second.body.settlements[0].id).toBe(first.body.settlements[0].id);
      expect(first.body.transferExecuted).toBe(false);
      const item = first.body.settlements[0];
      expect(item.disbursementStatus).toBe('PENDING');
      expect(
        await db.facilitySettlementItem.count({
          where: { settlementId: item.id },
        }),
      ).toBe(1);
      const failed = await call(
        'post',
        '/api/v1/finance/settlements/monthly',
        'admin',
        {
          ...dto,
          action: 'MARK_FAILED',
          settlementId: item.id,
          failureReason: 'DEMO - Ngân hàng từ chối lệnh thử nghiệm.',
        },
        201,
      );
      expect(failed.body.disbursementStatus).toBe('FAILED');
      expect(failed.body.failureReason).toContain('DEMO');
      const confirmation = {
        ...dto,
        action: 'CONFIRM_TRANSFER',
        settlementId: item.id,
        bankTransferOrderId: 'DEMO-BANK-RECONCILED-001',
        amountPaidVnd: 850000,
        paidAt: new Date().toISOString(),
        evidenceKey: `${demoIds.admin}/settlements/demo-proof.pdf`,
      };
      await call(
        'post',
        '/api/v1/finance/settlements/monthly',
        'admin',
        { ...confirmation, amountPaidVnd: 1 },
        400,
      );
      const settled = await call(
        'post',
        '/api/v1/finance/settlements/monthly',
        'admin',
        confirmation,
        201,
      );
      expect(settled.body.disbursementStatus).toBe('SETTLED');
      const replay = await call(
        'post',
        '/api/v1/finance/settlements/monthly',
        'admin',
        confirmation,
        201,
      );
      expect(replay.body.id).toBe(item.id);
      await call(
        'post',
        '/api/v1/finance/settlements/monthly',
        'admin',
        {
          ...dto,
          action: 'MARK_FAILED',
          settlementId: item.id,
          failureReason: 'DEMO - Không được ghi đè kết quả đã chốt.',
        },
        409,
      );
    });
    it('uses documented SePay HMAC/API-key protocols and builds live QR data without making any transfer', async () => {
      process.env.SEPAY_WEBHOOK_AUTH = 'apikey';
      process.env.SEPAY_WEBHOOK_API_KEY =
        'test-sepay-api-key-at-least-32-characters';
      const ignored = {
        id: ++txSequence,
        gateway: 'TEST_BANK',
        accountNumber: '0000000000',
        transferType: 'out',
        transferAmount: 1000,
        code: null,
        content: 'DEMO',
        transactionDate: new Date(Date.now() + 7 * 3600000)
          .toISOString()
          .slice(0, 19)
          .replace('T', ' '),
      };
      await request(app.getHttpServer())
        .post('/api/v1/payments/webhook/vietqr')
        .set('Authorization', 'Apikey wrong')
        .send(ignored)
        .expect(401);
      await request(app.getHttpServer())
        .post('/api/v1/payments/webhook/vietqr')
        .set('Authorization', 'Apikey ' + process.env.SEPAY_WEBHOOK_API_KEY)
        .send(ignored)
        .expect(200);
      process.env.SEPAY_WEBHOOK_AUTH = 'hmac';
      const source = await db.medicalContract.findUniqueOrThrow({
        where: { id: demoIds.pendingContract },
      });
      const family = await db.familyUnit.create({
        data: {
          representativeUser: {
            create: {
              email: `live-config-${randomUUID()}@demo.famidoc.invalid`,
              phone: '+84919990000',
              passwordHash: 'TEST-NOT-A-LOGIN',
              fullName: 'DEMO config',
              role: 'FAMILY_REP',
              status: 'ACTIVE',
            },
          },
          homeAddress: 'DEMO',
          emergencyPhone: '+84919990000',
        },
      });
      const {
        id: _id,
        createdAt: _created,
        updatedAt: _updated,
        ...data
      } = source;
      const live = await db.medicalContract.create({
        data: {
          ...data,
          legacyMemberIds: source.legacyMemberIds ?? undefined,
          terminationRequests:
            source.terminationRequests as Prisma.InputJsonValue,
          contractNumber: 'DEMO-LOCAL-LIVE-CONFIG',
          familyId: family.id,
          isDemo: false,
          billingSnapshot: source.billingSnapshot as Prisma.InputJsonValue,
        },
      });
      for (const [signerRole, signerUserId] of [
        ['FAMILY_REP', family.representativeUserId],
        ['ADMIN', demoIds.admin],
        ['HEALTHCARE_FACILITY', demoIds.facilityUser],
        ['ASSIGNED_DOCTOR', demoIds.doctorUser],
      ] as const)
        await db.contractSignature.create({
          data: {
            contractId: live.id,
            signerRole,
            signerUserId,
            signatureHash: 'DEMO-LOCAL-ONLY',
            ipAddress: '127.0.0.1',
          },
        });
      process.env.PAYMENTS_MODE = 'live';
      process.env.PAYMENTS_EXPECTED_ACCOUNT = '1234567890';
      process.env.PAYMENTS_EXPECTED_GATEWAY = 'Vietcombank';
      try {
        await call(
          'post',
          '/api/v1/payments/vietqr',
          'admin',
          { contractId: upgrade.id },
          409,
        );
        const payment = await call(
          'post',
          '/api/v1/payments/vietqr',
          'admin',
          { contractId: live.id },
          201,
        );
        expect(payment.body.environment).toBe('LIVE');
        const url = new URL(payment.body.qrUrl);
        expect(url.hostname).toBe('vietqr.app');
        expect(url.searchParams.get('acc')).toBe('1234567890');
        expect(url.searchParams.get('bank')).toBe('Vietcombank');
        expect(url.searchParams.get('amount')).toBe('2850000');
        expect(url.searchParams.get('des')).toBe(payment.body.transferContent);
        expect(payment.body.transferContent).toMatch(/ - FD[0-9]{6}$/);
        expect(payment.body.paymentCode).toMatch(/^FD[0-9]{6}$/);
        // Chỉ phát dữ liệu URL, tuyệt đối không tải QR hay gửi lệnh chuyển tiền trong test.
        await pay(payment.body, {
          gateway: 'Vietcombank',
          accountNumber: '1234567890',
        });
        expect(
          (
            await db.invoice.findUniqueOrThrow({
              where: { id: payment.body.id },
            })
          ).environment,
        ).toBe('LIVE');
        expect(
          (
            await db.medicalContract.findUniqueOrThrow({
              where: { id: live.id },
            })
          ).contractStatus,
        ).toBe('ACTIVE');
      } finally {
        process.env.PAYMENTS_MODE = 'simulation';
        process.env.PAYMENTS_EXPECTED_ACCOUNT = '0000000000';
        process.env.PAYMENTS_EXPECTED_GATEWAY = 'TEST_BANK';
      }
    });
  },
);
