import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createHmac, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/database/prisma.service';
import { StorageService } from '../src/core/services/storage.service';
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
    const legalScan = Buffer.from('%PDF-1.7\nTest legal scan\n');
    const mail = new Map<string, string>();
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
      })
        .overrideProvider(StorageService)
        .useValue({
          objectExists: async (key: string) => [
            `${demoIds.admin}/settlements/demo-proof.pdf`,
            `${demoIds.otherUser}/complaints/demo-proof.pdf`,
          ].includes(key) || key.startsWith(`${demoIds.admin}/settlements/`) && key.endsWith('/uploaded-proof.pdf'),
          uploadFile: async (_file: Express.Multer.File, folder: string) => `${folder}/uploaded-proof.pdf`,
          downloadFile: async (_key: string) => ({ bytes: legalScan, contentType: 'application/pdf' }),
        })
        .overrideProvider('MAILER_SERVICE')
        .useValue({ sendMail: async (message: { to: string; text: string }) => { mail.set(message.to, message.text); } })
        .compile();
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
          .send({ email: `${name}@demo.famidoc.invalid`, password })
          .expect(200);
        tokens[name] = 'Bearer ' + res.body.accessToken;
      }
    }, 120000);
    afterAll(async () => {
      await app?.close();
    });
    it('shares a prescription only with the confirmed family recipient and prevents duplicates', async () => {
      const patient = await db.patient.findFirstOrThrow({ where: { familyId: demoIds.otherFamily } });
      const visit = await db.encounter.create({
        data: {
          contractId: active,
          patientId: patient.id,
          doctorId: demoIds.doctor,
          category: 'AD_HOC_ON_DEMAND',
          encounterType: 'FACILITY_VISIT',
          encounterStatus: 'CONFIRMED',
          scheduledDate: new Date('2026-10-15T00:00:00.000Z'),
          scheduledTime: new Date('1970-01-01T08:00:00.000Z'),
        },
      });
      const visits = await call('get', '/api/v1/prescriptions/encounters', 'doctor');
      expect(visits.body.items).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: visit.id, recipient: expect.objectContaining({ id: demoIds.otherUser }) }),
      ]));
      const endpoint = `/api/v1/prescriptions/encounters/${visit.id}`;
      const payload = {
        recipientUserId: demoIds.otherUser,
        recipientAuthorized: true,
        exam: {
          chiefComplaint: 'Lý do khám thử',
          clinicalFindings: 'Kết quả thử',
          icd10Code: 'Z00.0',
          icd10Diagnosis: 'Khám tổng quát',
          treatmentPlan: 'Kế hoạch thử',
        },
        details: [{
          medicationName: 'Thuốc mẫu', strength: 'Hàm lượng mẫu', administrationRoute: 'Đường dùng mẫu',
          dosage: 'Liều mẫu', frequency: 'Tần suất mẫu', quantity: 6, unit: 'Đơn vị', durationDays: 3,
        }],
        instructions: 'Lời dặn kiểm thử',
      };
      await call('post', endpoint, 'family2', payload, 403);
      await call('post', endpoint, 'doctor', { ...payload, recipientAuthorized: false }, 400);
      await call('post', endpoint, 'doctor', { ...payload, recipientUserId: demoIds.familyUser }, 409);
      const created = await call('post', endpoint, 'doctor', payload, 201);
      await call('post', endpoint, 'doctor', payload, 409);

      const detail = '/api/v1/prescriptions/' + created.body.id;
      await call('get', detail, 'family', undefined, 404);
      const received = await call('get', detail, 'family2');
      expect(received.body).toMatchObject({
        id: created.body.id,
        patient: { id: patient.id },
        hasSignature: false,
        instructions: payload.instructions,
        details: [expect.objectContaining(payload.details[0])],
      });
      const history = await call('get', `/api/v1/prescriptions?patientId=${patient.id}`, 'family2');
      expect(history.body.items).toEqual([expect.objectContaining({ id: created.body.id })]);
      const notifications = await call('get', '/api/v1/notifications?type=PRESCRIPTION_SHARED', 'family2');
      expect(notifications.body.items).toEqual([expect.objectContaining({ referenceId: created.body.id, isRead: false })]);
      await call('patch', `/api/v1/notifications/${notifications.body.items[0].id}/read`, 'family2');
      const remaining = await call('get', '/api/v1/notifications?unreadOnly=true&type=PRESCRIPTION_SHARED', 'family2');
      expect(remaining.body.items).toEqual([]);
    }, 30000);

    it('keeps medical books scoped to the member, shows prior pages and confirms visits with or without a prescription', async () => {
      const patientId = '50000000-0000-4000-8000-000000000005';
      const otherMemberId = '50000000-0000-4000-8000-000000000006';
      const base = '/api/v1/medical-books';
      const roster = await call('get', `${base}/families`, 'doctor');
      const family = roster.body.items.find((entry: { id: string }) => entry.id === demoIds.otherFamily);
      expect(family.members).toEqual(expect.arrayContaining([expect.objectContaining({ id: patientId })]));
      expect(family.members).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: otherMemberId })]));
      const patientScope = `${base}/families/${demoIds.otherFamily}/patients/${patientId}`;
      await call('get', `${patientScope}/visits`, 'family', undefined, 404);
      const exam = {
        chiefComplaint: 'Lý do thử', clinicalFindings: 'Kết quả thử',
        icd10Code: 'Z00.0', icd10Diagnosis: 'Nội dung thử', treatmentPlan: 'Theo dõi thử',
      };
      const firstVisit = namScenarioIds.completedEncounter;
      const firstPage = `${base}/visits/${firstVisit}`;
      await call('get', firstPage, 'family2', undefined, 404);
      const confirm = `${firstPage}/confirm`;
      await call('post', confirm, 'family2', { patientId, confirmed: true, exam }, 403);
      await call('post', confirm, 'doctor', { patientId: otherMemberId, confirmed: true, exam }, 404);
      await call('post', confirm, 'doctor', { patientId, confirmed: false, exam }, 400);
      await call('post', confirm, 'doctor', { patientId, confirmed: true, exam: { ...exam, chiefComplaint: '   ' } }, 400);
      await call('post', confirm, 'doctor', { patientId, confirmed: true, exam }, 201);
      await call('post', confirm, 'doctor', { patientId, confirmed: true, exam }, 409);
      await call('get', firstPage, 'family', undefined, 404);
      const familyPage = await call('get', firstPage, 'family2');
      expect(familyPage.body).toMatchObject({ id: firstVisit, patient: { id: patientId }, isFinalized: true, prescription: null, exam });
      expect(await db.auditLog.count({ where: { action: 'CONFIRM_VISIT_RECORD', actorUserId: demoIds.doctorUser } })).toBe(1);

      const second = await db.encounter.create({ data: {
        contractId: active, patientId, doctorId: demoIds.doctor,
        category: 'AD_HOC_ON_DEMAND', encounterType: 'FACILITY_VISIT', encounterStatus: 'COMPLETED',
        scheduledDate: new Date('2026-10-14T00:00:00Z'), scheduledTime: new Date('1970-01-01T08:00:00Z'),
      } });
      const secondPage = `${base}/visits/${second.id}`;
      const prescription = {
        recipientUserId: demoIds.otherUser, recipientAuthorized: true,
        details: [{ medicationName: 'Thuốc mẫu', strength: 'Hàm lượng mẫu', administrationRoute: 'Đường dùng mẫu', dosage: 'Liều mẫu', frequency: 'Tần suất mẫu', quantity: 6, unit: 'Đơn vị', durationDays: 3 }],
      };
      await call('post', `${secondPage}/confirm`, 'doctor', { patientId, confirmed: true, exam, prescription: { ...prescription, details: [] } }, 400);
      await call('post', `${secondPage}/confirm`, 'doctor', { patientId, confirmed: true, exam, prescription: { ...prescription, recipientUserId: demoIds.familyUser } }, 409);
      expect(await db.clinicalEmr.count({ where: { encounterId: second.id } })).toBe(0);
      await call('post', `${secondPage}/confirm`, 'doctor', { patientId, confirmed: true, exam, prescription }, 201);
      const history = await call('get', `${patientScope}/visits`, 'family2');
      expect(history.body.items.map((entry: { id: string }) => entry.id)).toEqual([firstVisit, second.id]);
      expect((await call('get', secondPage, 'family2')).body.prescription.details).toEqual([expect.objectContaining(prescription.details[0])]);
      const otherHistory = await call('get', `${base}/families/${demoIds.otherFamily}/patients/${otherMemberId}/visits`, 'family2');
      expect(otherHistory.body.items).toEqual([]);
    }, 30000);

    it('accepts private medical book documents only from the owning family and downloads within scope', async () => {
      const patientId = '50000000-0000-4000-8000-000000000005';
      const anotherMember = '50000000-0000-4000-8000-000000000006';
      const folder = `/api/v1/medical-books/families/${demoIds.otherFamily}/patients`;
      const endpoint = `${folder}/${patientId}/documents`;
      const upload = (who: string, buffer: Buffer, date = '2026-11-18') => request(app.getHttpServer())
        .post(endpoint)
        .set('Authorization', tokens[who])
        .field('documentName', 'Phiếu thử')
        .field('documentType', 'LAB_RESULT')
        .field('recordedDate', date)
        .attach('file', buffer, 'result.pdf');
      await upload('doctor', legalScan).expect(403);
      await upload('family', legalScan).expect(404);
      await upload('family2', Buffer.from('Not PDF')).expect(400);
      await upload('family2', legalScan, '2026-02-30').expect(400);
      const uploaded = await upload('family2', legalScan).expect(201);
      expect(uploaded.body).toMatchObject({ fileUrl: null, downloadAvailable: true, documentName: 'Phiếu thử' });
      await call('get', endpoint, 'family', undefined, 404);
      const documents = await call('get', endpoint, 'family2');
      expect(documents.body).toEqual(expect.arrayContaining([expect.objectContaining({ id: uploaded.body.id, fileUrl: null })]));
      const empty = await call('get', `${folder}/${anotherMember}/documents`, 'family2');
      expect(empty.body).toEqual([]);
      const download = `${endpoint}/${uploaded.body.id}/file`;
      await call('get', download, 'family', undefined, 404);
      const response = await call('get', download, 'family2');
      expect(response.headers['content-type']).toMatch(/application\/pdf/);
      expect(response.headers['cache-control']).toBe('private, no-store');
      expect(response.body).toEqual(legalScan);
    }, 30000);

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
    it('requires a bearer token for VietQR creation and status', async () => {
      await call('post', '/api/v1/payments/vietqr', 'anonymous', { contractId: active }, 401);
      await call('get', `/api/v1/payments/${active}/status`, 'anonymous', undefined, 401);
    });

    it('serves live Admin data and enforces audited account access changes', async () => {
      await call('get', '/api/v1/admin/overview', 'family2', undefined, 403);
      const overview = await call('get', '/api/v1/admin/overview?period=weekly', 'admin');
      expect(overview.body.series).toHaveLength(7);
      expect(overview.body.activeContracts).toBe(0);
      const demoOverview = await call('get', '/api/v1/admin/overview?period=weekly&environment=TEST', 'admin');
      expect(demoOverview.body.facilities).toBeGreaterThan(0);
      expect(demoOverview.body.activeContracts).toBeGreaterThan(0);

      const users = await call('get', '/api/v1/admin/users?role=FAMILY_REP&limit=1', 'admin');
      expect(users.body.total).toBeGreaterThan(1);
      expect(users.body.items).toHaveLength(1);
      expect(users.body.items[0].passwordHash).toBeUndefined();

      const path = `/api/v1/admin/users/${demoIds.otherUser}/status`;
      await call('patch', path, 'family2', { status: 'SUSPENDED', reason: 'Tạm khóa kiểm thử' }, 403);
      await call('patch', path, 'admin', { status: 'SUSPENDED', reason: 'Tạm khóa kiểm thử' });
      try {
        await call('get', '/api/v1/users/profile', 'family2', undefined, 403);
        const audit = await call('get', `/api/v1/admin/audit-logs?resourceName=users&resourceId=${demoIds.otherUser}`, 'admin');
        expect(audit.body.items[0]).toMatchObject({
          action: 'ADMIN_SUSPEND_USER',
          details: { previousStatus: 'ACTIVE', status: 'SUSPENDED', reason: 'Tạm khóa kiểm thử' },
        });
      } finally {
        await call('patch', path, 'admin', { status: 'ACTIVE', reason: 'Khôi phục kiểm thử' });
      }
      await call('get', '/api/v1/users/profile', 'family2');
    });

    it('stores, reviews and resubmits an actual facility legal document', async () => {
      const email = 'onboarding@demo.famidoc.invalid';
      const created = await call('post', '/api/v1/facilities/register', 'anonymous', {
        facilityName: 'DEMO - Phòng khám kiểm thử pháp lý',
        representativeName: 'Đại diện kiểm thử',
        email,
        phone: '0905887711',
        address: '26 Đường kiểm thử, Hà Nội',
      }, 201);
      const id = created.body.id;
      const base = `/api/v1/admin/facilities/${id}`;
      await call('patch', `${base}/approve-account`, 'admin', { approved: true });
      const issuedPassword = /Mật khẩu khởi tạo: (\S+)/.exec(mail.get(email) ?? '')?.[1];
      expect(issuedPassword).toBeTruthy();
      expect(issuedPassword).not.toBe('FamiDoc@Facility2026');
      await call('post', `${base}/resend-invite`, 'admin', undefined, 201);
      const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email, password: issuedPassword }).expect(200);
      tokens.onboarding = 'Bearer ' + login.body.accessToken;
      const profile = {
        licenseNumber: '90078/BYT-GPHĐ', taxCode: '0120987656', hotline: '19001199',
        bankName: 'Ngân hàng kiểm thử', bankAccountNumber: '3087856235',
        bankAccountHolder: 'PHONG KHAM KIEM THU', licenseIssuer: 'Sở Y tế', licenseDate: '2025-02-12',
      };
      let upload = request(app.getHttpServer())
        .put('/api/v1/facilities/me/legal-profile').set('Authorization', tokens.onboarding);
      for (const [key, value] of Object.entries(profile)) upload = upload.field(key, value);
      const submitted = await upload.attach('file', legalScan, 'license.pdf').expect(200);
      expect(submitted.body).toMatchObject({ hasLegalDocument: true, licenseIssuer: 'Sở Y tế' });
      expect(submitted.body.legalDocumentKey).toBeUndefined();

      await call('get', `${base}/legal-document`, 'onboarding', undefined, 403);
      await call('get', `${base}/legal-document`, 'admin');
      await call('patch', `${base}/verify-legal`, 'admin', { approved: false, rejectionReason: 'Cần đối chiếu lại bản scan.' });
      const rejected = await call('get', base, 'admin');
      expect(rejected.body.legalRejectionReason).toBe('Cần đối chiếu lại bản scan.');
      const resubmitted = await call('put', '/api/v1/facilities/me/legal-profile', 'onboarding', profile);
      expect(resubmitted.body).toMatchObject({ hasLegalDocument: true, legalRejectionReason: null });
      const verified = await call('patch', `${base}/verify-legal`, 'admin', { approved: true });
      expect(verified.body.verificationStatus).toBe('ACTIVE');
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
      await call(
        'post',
        '/api/v1/complaints',
        'family2',
        {
          contractId: active,
          category: 'DOCTOR_ABSENT',
          description: 'DEMO - Bác sĩ không đến đúng hẹn.',
          evidenceKeys: [`${demoIds.otherUser}/complaints/missing.pdf`],
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
          evidenceKeys: [`${demoIds.otherUser}/complaints/demo-proof.pdf`],
        },
        201,
      );
      complaintId = item.body.id;
      expect(item.body.targetUserId).toBe(demoIds.doctorUser);
      expect(item.body.evidenceAttachments).toEqual([`${demoIds.otherUser}/complaints/demo-proof.pdf`]);
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
      await call('get', '/api/v1/admin/complaints', 'facility', undefined, 403);
      await call('get', '/api/v1/facilities/me/complaints', 'family2', undefined, 403);
      const adminQueue = await call('get', '/api/v1/admin/complaints?status=SUBMITTED', 'admin');
      const facilityQueue = await call('get', '/api/v1/facilities/me/complaints?status=SUBMITTED', 'facility');
      expect(adminQueue.body.items).toEqual(expect.arrayContaining([expect.objectContaining({ id: complaintId })]));
      expect(facilityQueue.body.items).toEqual(expect.arrayContaining([expect.objectContaining({ id: complaintId })]));
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
    it('creates a renewal contract in PENDING_PAYMENT without 4-party signing and keeps old ACTIVE until startDate (R1–R9)', async () => {
      const preview = await call(
        'get',
        `/api/v1/contracts/${active}/renewal-preview`,
        'family2',
      );
      expect(preview.body.eligible).toBe(true);
      expect(preview.body.caseType).toBe('CASE_A');

      // R6: Không cho phép đổi gói khi gia hạn
      await call(
        'post',
        `/api/v1/contracts/${active}/upgrade`,
        'family2',
        { packageId: '70000000-0000-4000-8000-000000000002', kind: 'UPGRADE' },
        400,
      );

      const created = await call(
        'post',
        `/api/v1/contracts/${active}/renew`,
        'family2',
        {
          acceptedTerms: true,
          termsHash: preview.body.termsHash,
        },
        201,
      );
      upgrade = created.body;
      expect(JSON.stringify(upgrade)).not.toContain('passwordHash');
      expect(upgrade.doctor).toBeUndefined();
      expect(upgrade.facility).toBeUndefined();
      expect(upgrade.id).not.toBe(active);
      expect(upgrade.contractStatus).toBe('PENDING_PAYMENT');
      expect(upgrade.upgradedFromId).toBe(active);

      // R8: Không cho phép ký 4 bên qua sign-upgrade đối với kỳ gia hạn
      await call(
        'put',
        `/api/v1/contracts/${upgrade.id}/sign-upgrade`,
        'admin',
        {
          termsHash: preview.body.termsHash,
          acceptedTerms: true,
        },
        409,
      );

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
      ).toBe('PENDING_ACTIVATION');
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
      const reviewPath = `/api/v1/finance/settlements/${item.id}/review`;
      const review = { environment: 'TEST', reviewVersion: item.reviewVersion, action: 'CONFIRM' };
      await call('patch', reviewPath, 'admin', review, 403);
      await call('post', '/api/v1/finance/settlements/monthly', 'admin', confirmation, 409);

      const disputed = await call('patch', reviewPath, 'facility', {
        ...review,
        action: 'REPORT_DISCREPANCY',
        reason: 'Cần kiểm tra số hóa đơn trong kỳ.',
      });
      expect(disputed.body.reviewStatus).toBe('DISPUTED');
      expect(disputed.body.reviewDisputeReason).toContain('số hóa đơn');
      await call('post', '/api/v1/finance/settlements/monthly', 'admin', confirmation, 409);
      const reopened = await call('post', '/api/v1/finance/settlements/monthly', 'admin', {
        ...dto,
        settlementId: item.id,
        action: 'REOPEN_REVIEW',
        reviewVersion: item.reviewVersion,
      }, 201);
      expect(reopened.body.reviewStatus).toBe('PENDING');
      await call('patch', reviewPath, 'facility', review, 409);
      const confirmed = await call('patch', reviewPath, 'facility', {
        ...review,
        reviewVersion: reopened.body.reviewVersion,
      });
      expect(confirmed.body.reviewStatus).toBe('CONFIRMED');
      expect(confirmed.body.disbursementStatus).toBe('FAILED');

      const evidencePath = `/api/v1/finance/settlements/${item.id}/evidence?environment=TEST`;
      const uploaded = await request(app.getHttpServer()).post(evidencePath)
        .set('Authorization', tokens.admin)
        .attach('file', Buffer.from('%PDF-1.7\n'), { filename: 'proof.pdf', contentType: 'application/pdf' })
        .expect(201);
      expect(uploaded.body.evidenceKey).toBe(`${demoIds.admin}/settlements/${item.id}/uploaded-proof.pdf`);
      confirmation.evidenceKey = uploaded.body.evidenceKey;
      await call(
        'post',
        '/api/v1/finance/settlements/monthly',
        'admin',
        { ...confirmation, amountPaidVnd: 1 },
        400,
      );
      await call(
        'post',
        '/api/v1/finance/settlements/monthly',
        'admin',
        { ...confirmation, evidenceKey: `${demoIds.admin}/settlements/missing.pdf` },
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
        const adjustment = {
          contractId: live.id,
          amountVnd: 2840000,
          transferDescription: 'THU PHI DIEU CHINH',
          reason: 'Điều chỉnh cho bài kiểm thử local.',
        };
        await call('post', '/api/v1/payments/vietqr', 'family', adjustment, 400);
        await call('post', '/api/v1/payments/admin/requests', 'family', adjustment, 403);
        const adjusted = await call('post', '/api/v1/payments/admin/requests', 'admin', adjustment, 201);
        expect(adjusted.body.paymentCode).not.toBe(payment.body.paymentCode);
        expect(adjusted.body.transferContent).toBe(`THU PHI DIEU CHINH ${adjusted.body.paymentCode}`);
        expect(new URL(adjusted.body.qrUrl).searchParams.get('amount')).toBe('2840000');
        expect((await db.invoice.findUniqueOrThrow({ where: { id: payment.body.id } })).paymentStatus).toBe('CANCELLED');
        const fromRegularFlow = await call('post', '/api/v1/payments/vietqr', 'admin', { contractId: live.id }, 201);
        expect(fromRegularFlow.body.id).toBe(adjusted.body.id);
        expect(await db.auditLog.findFirst({
          where: { action: 'ADMIN_ADJUST_PAYMENT_REQUEST', resourceId: adjusted.body.id },
        })).toMatchObject({ details: { previousAmountVnd: 2850000, amountVnd: 2840000, reason: adjustment.reason } });

        // Chỉ phát dữ liệu URL, tuyệt đối không tải QR hay gửi lệnh chuyển tiền trong test.
        const wrong = await pay(adjusted.body, {
          gateway: 'Vietcombank',
          accountNumber: '1234567890',
          transferAmount: payment.body.amountVnd,
        });
        const matched = await pay(adjusted.body, {
          gateway: 'Vietcombank',
          accountNumber: '1234567890',
        });
        await call('get', '/api/v1/payments/webhook-events', 'family', undefined, 403);
        const log = await call('get', '/api/v1/payments/webhook-events?environment=LIVE', 'admin');
        expect(log.body.items).toEqual(expect.arrayContaining([
          expect.objectContaining({ providerTransactionId: String(wrong.payload.id), status: 'ERROR', httpStatus: 200, resultCode: 'AMOUNT_MISMATCH' }),
          expect.objectContaining({ providerTransactionId: String(matched.payload.id), status: 'SUCCESS', httpStatus: 200, resultCode: 'MATCHED' }),
        ]));
        const denied = await call('get', '/api/v1/payments/webhook-events?environment=TEST&status=ERROR', 'admin');
        expect(denied.body.items).toEqual(expect.arrayContaining([
          expect.objectContaining({ status: 'ERROR', httpStatus: 401, resultCode: 'INVALID_API_KEY' }),
        ]));
        expect(
          (
            await db.invoice.findUniqueOrThrow({
              where: { id: adjusted.body.id },
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
