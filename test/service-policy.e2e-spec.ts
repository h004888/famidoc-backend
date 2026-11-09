import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/database/prisma.service';
import { demoIds, seedDemo } from '../prisma/seed';

(process.env.RUN_DB_TESTS === '1' ? describe : describe.skip)(
  'Bảng dịch vụ mới: HTTP + DB thật local',
  () => {
    let app: INestApplication, db: PrismaService;
    const tokens: Record<string, string> = {},
      packages: Record<number, string> = {};
    const tariff = [
      [1, 1, 2, 1, 1, 1000000, 1000000],
      [3, 3, 6, 3, 4, 2850000, 950000],
      [6, 4, 8, 7, 8, 6475000, 925000],
      [12, 6, 10, 14, 0, 12600000, 900000],
    ];
    let invoiceId: string, contractId: string;
    function api(
      method: 'get' | 'post',
      path: string,
      who = 'admin',
      body?: object,
    ) {
      const req = request(app.getHttpServer())
        [method](path)
        .set('Authorization', tokens[who]);
      return body ? req.send(body) : req;
    }
    beforeAll(async () => {
      const target = new URL(process.env.DATABASE_URL!);
      if (
        !['127.0.0.1', 'localhost'].includes(target.hostname) ||
        !target.pathname.endsWith('_test')
      )
        throw Error('Chỉ dùng DB test local riêng.');
      Object.assign(process.env, {
        NODE_ENV: 'development',
        JWT_SECRET: 'new-policy-tests-00000000000000000000000',
        PAYMENTS_MODE: 'simulation',
        CONTRACT_REMINDERS_ENABLED: 'false',
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
      const password = 'NewPolicy_Test_Password_2026';
      await seedDemo(db, password);
      for (const who of ['admin', 'family', 'facility']) {
        const res = await request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .send({ identifier: `${who}@demo.famidoc.invalid`, password })
          .expect(200);
        tokens[who] = 'Bearer ' + res.body.accessToken;
      }
      for (const [months, members, max, home, video, price, unit] of tariff) {
        const created = await api(
          'post',
          '/api/v1/admin/care-packages',
          'admin',
          {
            code: `NEW_POLICY_${months}`,
            name: `Gói mới ${months}`,
            durationMonths: months,
            includedMembers: members,
            maxMembers: max,
            priceVnd: price,
            additionalMemberMonthlyPriceVnd: 75000,
            quotaPeriod: 'PER_TERM',
            quotas: {
              homeVisits: home,
              videoConsultations: video,
              facilityVisits: 0,
            },
            homeVisitUnitPriceVnd: unit,
            videoQuotaPolicy: months === 12 ? 'CONTRACT' : 'FIXED',
          },
        ).expect(201);
        packages[months] = created.body.id;
        await api(
          'post',
          `/api/v1/admin/care-packages/${created.body.id}/publish`,
        ).expect(201);
      }
    }, 120000);
    afterAll(async () => {
      await app?.close();
    });
    it('giá Đồng hành 5 người, Tiến sĩ là 3.600.000đ; gói 6 tháng nhận 8 người và từ chối người thứ 9', async () => {
      const quote = await api(
        'post',
        `/api/v1/care-packages/${packages[3]}/quote`,
        'family',
        { memberCount: 5, doctorTier: 'DOCTORATE' },
      ).expect(200);
      expect(quote.body.pricing.totalPriceVnd).toBe(3600000);
      const eight = await api(
        'post',
        `/api/v1/care-packages/${packages[6]}/quote`,
        'family',
        { memberCount: 8 },
      ).expect(200);
      expect(eight.body.pricing.totalPriceVnd).toBe(8275000);
      expect(eight.body.benefits.quotas).toMatchObject({
        homeVisits: 7,
        videoConsultations: 8,
      });
      const denied = await api(
        'post',
        `/api/v1/care-packages/${packages[6]}/quote`,
        'family',
        { memberCount: 9 },
      ).expect(400);
      expect(denied.body.suggestHigherPackage).toBe(true);
    });
    it('hợp đồng năm bắt buộc quota video cụ thể; báo giá dùng đúng học vị bác sĩ từ DB', async () => {
      const body = {
        packageId: packages[12],
        facilityId: demoIds.facility,
        doctorId: demoIds.doctor,
      };
      await api('post', '/api/v1/contracts/medical', 'family', body).expect(
        400,
      );
      await db.doctor.update({
        where: { id: demoIds.doctor },
        data: { academicTitle: 'Tiến sĩ' },
      });
      const contract = await api(
        'post',
        '/api/v1/contracts/medical',
        'family',
        { ...body, videoConsultations: 24 },
      ).expect(201);
      expect(contract.body.totalAmount).toBe(14000000);
      expect(contract.body.remainingTelehealth).toBe(24);
      const row = await db.medicalContract.findUniqueOrThrow({
        where: { id: contract.body.id },
      });
      expect((row.billingSnapshot as any).pricing.doctorSurchargeTotalVnd).toBe(
        1400000,
      );
      await db.doctor.update({
        where: { id: demoIds.doctor },
        data: { academicTitle: null },
      });
    });
    it('một hóa đơn được quyết toán qua ba tháng, gọi lại không cộng trùng', async () => {
      const contract = await db.medicalContract.create({
        data: {
          contractNumber: 'TEST-DAYS-' + randomUUID(),
          familyId: demoIds.family,
          facilityId: demoIds.facility,
          doctorId: demoIds.doctor,
          packageId: packages[3],
          totalAmount: 3000000,
          remainingHomeVisits: 0,
          remainingTelehealth: 0,
          startDate: new Date('2026-07-01Z'),
          endDate: new Date('2026-10-01Z'),
          contractStatus: 'EXPIRED',
          isDemo: true,
          memberCount: 4,
          billingSnapshot: {},
        },
      });
      contractId = contract.id;
      const invoice = await db.invoice.create({
        data: {
          invoiceCode: 'TEST-' + randomUUID(),
          contractId,
          grossAmount: 3000000,
          totalPayable: 3000000,
          createdAt: new Date('2026-06-30T16:00Z'),
          expiredAt: new Date('2026-07-01Z'),
          environment: 'TEST',
        },
      });
      invoiceId = invoice.id;
      const tx = await db.paymentTransaction.create({
        data: {
          invoiceId,
          gatewayTransactionId: randomUUID(),
          amountReceived: 3000000,
          paymentTime: new Date('2026-06-30T17:00Z'),
          signatureVerified: true,
          webhookPayload: { demo: true },
          environment: 'TEST',
          fingerprint: '0'.repeat(64),
          gateway: 'TEST_BANK',
          accountNumber: '0000000000',
          transferType: 'in',
          outcome: 'MATCHED',
        },
      });
      await db.invoice.update({
        where: { id: invoiceId },
        data: {
          paymentStatus: 'PAID',
          paidAt: tx.paymentTime,
          acceptedTransactionId: tx.id,
        },
      });
      let sum = 0,
        fee = 0;
      for (const month of [7, 8, 9]) {
        const body = {
          year: 2026,
          month,
          environment: 'TEST',
          action: 'PREPARE',
        };
        await api(
          'post',
          '/api/v1/finance/settlements/monthly',
          'admin',
          body,
        ).expect(201);
        await api(
          'post',
          '/api/v1/finance/settlements/monthly',
          'admin',
          body,
        ).expect(201);
        const rows = await db.facilitySettlementItem.findMany({
          where: { invoiceId, recognitionMonth: month },
        });
        expect(rows).toHaveLength(1);
        sum += Number(rows[0].grossAmount);
        fee += Number(rows[0].platformFeeAmount);
      }
      expect(sum).toBe(3000000);
      expect(fee).toBe(450000);
    });
    it('đánh giá 1 sao xuất hiện trong báo cáo nhưng không giảm tiền đã tính', async () => {
      const before = await api(
        'get',
        '/api/v1/finance/analytics?year=2026&month=7&environment=TEST',
      ).expect(200);
      const encounter = await db.encounter.create({
        data: {
          contractId,
          doctorId: demoIds.doctor,
          patientId: '50000000-0000-4000-8000-000000000001',
          encounterType: 'HOME_VISIT',
          category: 'PERIODIC_ROUTINE',
          encounterStatus: 'COMPLETED',
          scheduledDate: new Date('2026-07-05Z'),
          scheduledTime: new Date('1970-01-01T08:00Z'),
        },
      });
      await db.doctorReview.create({
        data: {
          encounterId: encounter.id,
          doctorId: demoIds.doctor,
          familyId: demoIds.family,
          ratingStars: 1,
          createdAt: new Date('2026-07-06Z'),
        },
      });
      const after = await api(
        'get',
        '/api/v1/finance/analytics?year=2026&month=7&environment=TEST',
      ).expect(200);
      expect(after.body.satisfaction).toMatchObject({
        reviewCount: 1,
        averageStars: 1,
        affectsPayout: false,
      });
      expect(after.body.facilityShareVnd).toBe(before.body.facilityShareVnd);
    });
    it('chạy nhắc hợp đồng hai lần chỉ tạo một thông báo; gia đình không được gọi tác vụ Admin', async () => {
      const soon = await db.medicalContract.findFirstOrThrow({
        where: { isDemo: false, contractStatus: 'PENDING_APPROVAL' },
      });
      const today = new Date();
      today.setUTCDate(today.getUTCDate() + 10);
      await db.medicalContract.update({
        where: { id: soon.id },
        data: { contractStatus: 'ACTIVE', endDate: today },
      });
      await api('post', '/api/v1/notifications/reminders/run', 'family').expect(
        403,
      );
      await api('post', '/api/v1/notifications/reminders/run').expect(201);
      await api('post', '/api/v1/notifications/reminders/run').expect(201);
      expect(
        await db.notification.count({
          where: { referenceId: soon.id, type: 'CONTRACT_EXPIRY_15D' },
        }),
      ).toBe(1);
    });
  },
);
