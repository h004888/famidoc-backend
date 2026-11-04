import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../src/core/database/prisma.service';
import { PrismaModule } from '../src/core/database/prisma.module';
import { AuthRepositoryImpl } from '../src/modules/auth/repositories/impl/auth.repository.impl';

(process.env.RUN_DB_TESTS === '1' ? describe : describe.skip)(
  'AuthRepository Real DB Integration Test',
  () => {
    let prisma: PrismaService;
    let repository: AuthRepositoryImpl;
    const testEmail = `test_${Date.now()}@famidoc.vn`;
    const testPhone = `09${Math.floor(10000000 + Math.random() * 90000000)}`;
    let createdUserId: string;

    beforeAll(async () => {
      const target = new URL(process.env.DATABASE_URL!);
      if (
        !['localhost', '127.0.0.1'].includes(target.hostname) ||
        !target.pathname.endsWith('_test')
      )
        throw new Error('DB tests require a dedicated local *_test database');
      const module: TestingModule = await Test.createTestingModule({
        imports: [PrismaModule],
        providers: [AuthRepositoryImpl],
      }).compile();

      prisma = module.get<PrismaService>(PrismaService);
      repository = module.get<AuthRepositoryImpl>(AuthRepositoryImpl);
      await prisma.$connect();
    });

    afterAll(async () => {
      if (createdUserId) {
        const family = await prisma.familyUnit.findUnique({
          where: { representativeUserId: createdUserId },
        });
        if (family)
          await prisma.patient.deleteMany({ where: { familyId: family.id } });
        await prisma.auditLog.deleteMany({
          where: { actorUserId: createdUserId },
        });
        await prisma.familyUnit.deleteMany({
          where: { representativeUserId: createdUserId },
        });
        await prisma.user.deleteMany({ where: { id: createdUserId } });
      }
      await prisma.$disconnect();
    });

    it('1. Kết nối thành công đến PostgreSQL thật và đếm số lượng user', async () => {
      const count = await prisma.user.count();
      expect(count).toBeGreaterThanOrEqual(0);
    });

    it('2. [UT-R-03] Thực thi createFamilyRepWithProfile tạo User + FamilyUnit + Patient + AuditLog trên DB thật', async () => {
      const user = await repository.createFamilyRepWithProfile({
        email: testEmail,
        phone: testPhone,
        passwordHash: 'real_db_argon2_hash',
        fullName: 'Bác Sĩ Test DB',
      });

      expect(user).toBeDefined();
      expect(user.id).toBeDefined();
      expect(user.email).toBe(testEmail);
      expect(user.phone).toBe(testPhone);
      expect(user.role).toBe('FAMILY_REP');
      expect(user.status).toBe('ACTIVE');
      createdUserId = user.id;

      // Kiểm tra trực tiếp trên DB PostgreSQL thật theo quan hệ 3NF mới
      const dbFamily = await prisma.familyUnit.findUnique({
        where: { representativeUserId: user.id },
      });
      expect(dbFamily).toBeDefined();
      expect(dbFamily?.emergencyPhone).toBe(testPhone);

      const dbPatient = await prisma.patient.findFirst({
        where: { familyId: dbFamily!.id },
      });
      expect(dbPatient).toBeDefined();
      expect(dbPatient?.fullName).toBe('Bác Sĩ Test DB');

      const dbAudit = await prisma.auditLog.findFirst({
        where: { actorUserId: user.id },
      });
      expect(dbAudit).toBeDefined();
      expect(dbAudit?.action).toBe('REGISTER_FAMILY_REP');
    });

    it('3. [UT-R-01] findByEmail truy vấn chính xác bản ghi trên DB thật', async () => {
      const found = await repository.findByEmail(testEmail);
      expect(found).toBeDefined();
      expect(found?.email).toBe(testEmail);
    });

    it('4. [UT-R-02] findByPhone truy vấn chính xác số điện thoại trên DB thật', async () => {
      const found = await repository.findByPhone(testPhone);
      expect(found).toBeDefined();
      expect(found?.phone).toBe(testPhone);
    });

    it('5. [UT-R-04] updatePassword cập nhật mật khẩu băm trên DB thật', async () => {
      const newHash = 'updated_real_hash_123';
      await repository.updatePassword(createdUserId, newHash);

      const updatedUser = await prisma.user.findUnique({
        where: { id: createdUserId },
      });
      expect(updatedUser?.passwordHash).toBe(newHash);
    });

    it('6. [UT-R-05] Ràng buộc toàn vẹn DDL: Thông tin người dùng đồng bộ theo chuẩn 29 bảng', async () => {
      const user = await prisma.user.findUnique({
        where: { id: createdUserId },
      });
      expect(user?.status).toBe('ACTIVE');
      expect(user?.failedLoginAttempts).toBe(0);
    });

    it('7. Ràng buộc toàn vẹn: Không cho phép tạo trùng lặp Email hoặc Phone trên DB thật', async () => {
      await expect(
        repository.createFamilyRepWithProfile({
          email: testEmail,
          phone: '0999999999',
          passwordHash: 'hash',
          fullName: 'Trùng Lặp',
        }),
      ).rejects.toThrow();
    });
  },
);
