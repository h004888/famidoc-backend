import {
  CanActivate,
  ExecutionContext,
  INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { JwtAuthGuard } from '../../../core/auth/jwt-auth.guard';
import type { AuthenticatedUser } from '../../../core/auth/authenticated-request';
import { RolesGuard } from '../../../core/auth/roles.guard';
import { StandardApiResponseFilter } from '../../../core/filters/standard-api-response.filter';
import { TransformResponseInterceptor } from '../../../core/interceptors/transform-response.interceptor';
import { QuotaPeriod } from '../../care-packages/entities/care-package.entity';
import { InMemoryCarePackagesRepository } from '../../care-packages/repositories/impl/in-memory-care-packages.repository';
import { CarePackagesServiceImpl } from '../../care-packages/services/impl/care-packages.service.impl';
import { PaymentsController } from '../controllers/payments.controller';
import {
  BillingContractStatus,
  PaymentRequestStatus,
} from '../entities/payment.entity';
import { PaymentsClock } from '../payments.clock';
import { PaymentsConfig } from '../payments.config';
import { InMemoryPaymentsRepository } from '../repositories/impl/in-memory-payments.repository';
import { PAYMENTS_REPOSITORY_TOKEN } from '../repositories/interfaces/payments.repository.interface';
import { SePayWebhookEvents } from '../sepay/sepay-webhook-events';
import { PaymentsServiceImpl } from '../services/impl/payments.service.impl';
import { PAYMENTS_SERVICE_TOKEN } from '../services/interfaces/payments.service.interface';
import { PaymentTestService } from './payment-test-fixture';

describe('PaymentsController (recheck-activation HTTP route)', () => {
  let app: INestApplication<App>;
  let service: PaymentTestService;
  let repository: InMemoryPaymentsRepository;
  let currentUser: AuthenticatedUser;
  let packageId: string;
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const key of [
      'NODE_ENV',
      'PAYMENTS_MODE',
      'PAYMENTS_EXPECTED_ACCOUNT',
      'PAYMENTS_EXPECTED_GATEWAY',
      'PAYMENT_REQUEST_TTL_MINUTES',
    ]) {
      savedEnv[key] = process.env[key];
    }
    process.env.NODE_ENV = 'development';
    process.env.PAYMENTS_MODE = 'simulation';
    process.env.PAYMENTS_EXPECTED_ACCOUNT = '0000000000';
    process.env.PAYMENTS_EXPECTED_GATEWAY = 'TEST_BANK';
    process.env.PAYMENT_REQUEST_TTL_MINUTES = '15';

    repository = new InMemoryPaymentsRepository();
    const clock = new PaymentsClock();
    clock.now = () => new Date('2026-10-27T01:00:00.000Z');
    const config = new PaymentsConfig();
    const packages = new CarePackagesServiceImpl(
      new InMemoryCarePackagesRepository(),
    );
    const pkg = await packages.create({
      code: 'CTRL',
      name: 'Controller test package',
      description: 'Example care package description.',
      durationMonths: 1,
      priceVnd: 950_000,
      includedMembers: 2,
      maxMembers: 4,
      additionalMemberMonthlyPriceVnd: 100_000,
      quotaPeriod: QuotaPeriod.PER_TERM,
      quotas: { videoConsultations: 1, homeVisits: 1 },
    } as any);
    packageId = pkg.id;

    service = new PaymentTestService(repository, packages, config, clock);

    const moduleRef = await Test.createTestingModule({
      controllers: [PaymentsController],
      providers: [
        RolesGuard,
        { provide: PAYMENTS_REPOSITORY_TOKEN, useValue: repository },
        { provide: PAYMENTS_SERVICE_TOKEN, useValue: service },
        { provide: PaymentsServiceImpl, useValue: service },
        { provide: PaymentsConfig, useValue: config },
        { provide: PaymentsClock, useValue: clock },
        { provide: SePayWebhookEvents, useValue: { list: jest.fn() } },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(context: ExecutionContext) {
          const req = context.switchToHttp().getRequest();
          req.user = currentUser;
          return true;
        },
      } satisfies CanActivate)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new TransformResponseInterceptor());
    app.useGlobalFilters(new StandardApiResponseFilter());
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
  });

  it('checks admin payment eligibility without creating a request and rechecks it when issuing', async () => {
    const familyId = randomUUID();
    const contract = await service.createDemoContract({ familyId, packageId, memberCount: 2 });
    await service.updateDemoRequirements(contract.id, {
      familySigned: true,
      adminSigned: true,
      facilitySigned: true,
      doctorSigned: true,
      facilityId: randomUUID(),
      doctorId: randomUUID(),
      doctorVerified: true,
      panelCapacityAvailable: true,
    });
    const eligibilityPath = '/api/v1/payments/admin/eligibility';
    currentUser = { id: randomUUID(), role: 'FAMILY_REP', familyUnitId: familyId };
    await request(app.getHttpServer()).get(eligibilityPath).query({ contractId: contract.id }).expect(403);

    currentUser = { id: randomUUID(), role: 'ADMIN', familyUnitId: null };
    const eligible = await request(app.getHttpServer())
      .get(eligibilityPath)
      .query({ contractId: contract.id })
      .expect('Cache-Control', 'private, no-store')
      .expect(200);
    expect(eligible.body.data).toEqual({ eligible: true, blockingReasons: [] });

    await service.updateDemoRequirements(contract.id, { doctorVerified: false });
    const blocked = await request(app.getHttpServer())
      .get(eligibilityPath)
      .query({ contractId: contract.id })
      .expect(200);
    expect(blocked.body.data).toMatchObject({
      eligible: false,
      blockingReasons: ['DOCTOR_VERIFICATION_REQUIRED'],
    });
    const rejected = await request(app.getHttpServer())
      .post('/api/v1/payments/admin/requests')
      .send({ contractId: contract.id, amountVnd: 100000, transferDescription: 'THU PHI', reason: 'Kiểm thử điều kiện' })
      .expect(409);
    expect(rejected.body.error.blockingReasons).toEqual(blocked.body.data.blockingReasons);
    expect(await repository.transaction((session) => session.listRequests(contract.id))).toEqual([]);
  });

  it('returns HTTP 200 with activated:false and blockingReasons for owner FAMILY_REP on PAID blocked contract', async () => {
    const familyId = randomUUID();
    const contract = await service.createDemoContract({
      familyId,
      packageId,
      memberCount: 2,
    });
    await service.updateDemoRequirements(contract.id, {
      familySigned: true,
      adminSigned: true,
      facilitySigned: true,
      doctorSigned: true,
      facilityId: randomUUID(),
      doctorId: randomUUID(),
      doctorVerified: true,
      panelCapacityAvailable: true,
    });
    const payment = await service.createVietQRPayment(contract.id);
    await service.updateDemoRequirements(contract.id, {
      doctorVerified: false,
    });
    await repository.transaction(async (session) => {
      const req = (await session.findRequest(payment.id))!;
      req.status = PaymentRequestStatus.PAID;
      req.paidAt = '2026-10-27T01:05:00.000Z';
      await session.saveRequest(req);
    });

    currentUser = {
      id: randomUUID(),
      role: 'FAMILY_REP',
      familyUnitId: familyId,
    };

    const blockedRes = await request(app.getHttpServer())
      .post(`/api/v1/payments/requests/${payment.id}/recheck-activation`)
      .expect(200);

    expect(blockedRes.body.data).toMatchObject({
      contractId: contract.id,
      status: BillingContractStatus.PENDING,
      activated: false,
      blockingReasons: ['DOCTOR_VERIFICATION_REQUIRED'],
    });

    // Khi điều kiện được gỡ bỏ, gọi lại cùng route trả activated:true với HTTP 200.
    await repository.transaction(async (session) => {
      const c = (await session.findContract(contract.id))!;
      c.requirements.doctorVerified = true;
      await session.saveContract(c);
    });

    const okRes = await request(app.getHttpServer())
      .post(`/api/v1/payments/requests/${payment.id}/recheck-activation`)
      .expect(200);

    expect(okRes.body.data).toMatchObject({
      contractId: contract.id,
      status: BillingContractStatus.ACTIVE,
      activated: true,
      blockingReasons: [],
    });
  });

  it('returns HTTP 403 when FAMILY_REP of another family calls recheck-activation', async () => {
    const familyId = randomUUID();
    const contract = await service.createDemoContract({
      familyId,
      packageId,
      memberCount: 2,
    });
    await service.updateDemoRequirements(contract.id, {
      familySigned: true,
      adminSigned: true,
      facilitySigned: true,
      doctorSigned: true,
      facilityId: randomUUID(),
      doctorId: randomUUID(),
      doctorVerified: true,
      panelCapacityAvailable: true,
    });
    const payment = await service.createVietQRPayment(contract.id);
    await repository.transaction(async (session) => {
      const req = (await session.findRequest(payment.id))!;
      req.status = PaymentRequestStatus.PAID;
      await session.saveRequest(req);
    });

    currentUser = {
      id: randomUUID(),
      role: 'FAMILY_REP',
      familyUnitId: randomUUID(),
    };

    await request(app.getHttpServer())
      .post(`/api/v1/payments/requests/${payment.id}/recheck-activation`)
      .expect(403);
  });

  it('allows ADMIN to call recheck-activation with HTTP 200', async () => {
    const familyId = randomUUID();
    const contract = await service.createDemoContract({
      familyId,
      packageId,
      memberCount: 2,
    });
    await service.updateDemoRequirements(contract.id, {
      familySigned: true,
      adminSigned: true,
      facilitySigned: true,
      doctorSigned: true,
      facilityId: randomUUID(),
      doctorId: randomUUID(),
      doctorVerified: true,
      panelCapacityAvailable: true,
    });
    const payment = await service.createVietQRPayment(contract.id);

    currentUser = {
      id: randomUUID(),
      role: 'ADMIN',
      familyUnitId: null,
    };

    const res = await request(app.getHttpServer())
      .post(`/api/v1/payments/requests/${payment.id}/recheck-activation`)
      .expect(200);

    expect(res.body.data).toMatchObject({
      contractId: contract.id,
      activated: false,
      blockingReasons: ['VERIFIED_PAYMENT_REQUIRED'],
    });
  });
});
