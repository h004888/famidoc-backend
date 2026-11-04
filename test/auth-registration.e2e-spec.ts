import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { randomInt, randomUUID } from 'node:crypto';
import { compare } from 'bcryptjs';
import request from 'supertest';
import type Redis from 'ioredis';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/database/prisma.service';

// Kiểm tra hai route đăng ký sau merge. Chỉ gửi mail giả trong test; không gọi SMTP thật.
(process.env.RUN_DB_TESTS === '1' ? describe : describe.skip)(
  'Merged family registration routes',
  () => {
    let app: INestApplication, db: PrismaService, redis: Redis;
    const emails: string[] = [],
      userIds: string[] = [];
    const mailer = { sendMail: jest.fn().mockResolvedValue(true) };

    beforeAll(async () => {
      const target = new URL(process.env.DATABASE_URL!);
      if (
        !['localhost', '127.0.0.1'].includes(target.hostname) ||
        !target.pathname.endsWith('_test')
      )
        throw new Error(
          'Registration tests require a dedicated local *_test database',
        );
      Object.assign(process.env, {
        NODE_ENV: 'development',
        JWT_SECRET: 'registration-integration-secret-000000000000',
      });
      const module = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider('MAILER_SERVICE')
        .useValue(mailer)
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
      redis = app.get('REDIS_CLIENT');
    });

    afterAll(async () => {
      if (db && userIds.length) {
        // Chỉ xóa tài khoản do chính test này tạo, không reset hay dọn dữ liệu của test khác.
        await db.$transaction(async (tx) => {
          const families = await tx.familyUnit.findMany({
            where: { representativeUserId: { in: userIds } },
            select: { id: true },
          });
          await tx.patient.deleteMany({
            where: { familyId: { in: families.map((f) => f.id) } },
          });
          await tx.auditLog.deleteMany({
            where: { actorUserId: { in: userIds } },
          });
          await tx.familyUnit.deleteMany({
            where: { representativeUserId: { in: userIds } },
          });
          await tx.user.deleteMany({ where: { id: { in: userIds } } });
        });
      }
      for (const email of emails)
        await redis?.del(`otp:reg:${email}`, `otp:cooldown:${email}`);
      await app?.close();
    });

    it.each(['/api/v1/auth/register-representative', '/api/v1/auth/register'])(
      '%s preserves the address, hashes the password and verifies OTP without exposing the hash',
      async (route) => {
        const email = `merge-${randomUUID()}@famidoc.test`;
        emails.push(email);
        const password = 'IntegrationOnly_Password_2026';
        const homeAddress = 'Số 10 Phố Huế, Hà Nội';
        await request(app.getHttpServer())
          .post(route)
          .send({
            fullName: 'DEMO - Kiểm tra đăng ký sau merge',
            email,
            phone: '09' + String(randomInt(0, 100000000)).padStart(8, '0'),
            password,
            acceptedTerms: true,
            homeAddress,
          })
          .expect(201);
        const pending = JSON.parse((await redis.get(`otp:reg:${email}`))!);
        expect(pending.homeAddress).toBe(homeAddress);
        expect(pending.password).toBeUndefined();
        expect(await compare(password, pending.passwordHash)).toBe(true);
        const verified = await request(app.getHttpServer())
          .post('/api/v1/auth/verify-email-otp')
          .send({ email, otp: pending.otp })
          .expect(201);
        userIds.push(verified.body.id);
        expect(verified.body.passwordHash).toBeUndefined();
        const family = await db.familyUnit.findUniqueOrThrow({
          where: { representativeUserId: verified.body.id },
        });
        expect(family.homeAddress).toBe(homeAddress);
        expect(await redis.get(`otp:reg:${email}`)).toBeNull();
        expect(mailer.sendMail).toHaveBeenCalledWith(
          expect.objectContaining({ to: email }),
        );
      },
    );
  },
);
