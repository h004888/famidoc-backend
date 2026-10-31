import { todayInVietnam } from '../src/core/business/business-helpers';
import { Prisma, PrismaClient, type UserRole } from '@prisma/client';
import { hash } from 'bcryptjs';
import { calculateCarePackageQuote } from '../src/modules/care-packages/pricing/calculate-care-package-quote';
import {
  CarePackageStatus,
  QuotaPeriod,
} from '../src/modules/care-packages/entities/care-package.entity';
import { addContractMonths } from '../src/modules/payments/activation/contract-activation';

// ID ổn định giúp chạy seed nhiều lần không nhân bản tài khoản, hợp đồng hoặc hóa đơn.
export const demoIds = {
  admin: '10000000-0000-4000-8000-000000000001',
  facilityUser: '10000000-0000-4000-8000-000000000002',
  doctorUser: '10000000-0000-4000-8000-000000000003',
  familyUser: '10000000-0000-4000-8000-000000000004',
  otherUser: '10000000-0000-4000-8000-000000000005',
  facility: '20000000-0000-4000-8000-000000000001',
  doctor: '30000000-0000-4000-8000-000000000001',
  family: '40000000-0000-4000-8000-000000000001',
  otherFamily: '40000000-0000-4000-8000-000000000002',
  pendingContract: '60000000-0000-4000-8000-000000000001',
  activeContract: '60000000-0000-4000-8000-000000000002',
  encounter: '80000000-0000-4000-8000-000000000001',
};
export async function seedDemo(prisma: PrismaClient, password: string) {
  if (password.length < 16)
    throw new Error('DEMO_SEED_PASSWORD must contain at least 16 characters');
  const passwordHash = await hash(password, 12);
  const now = new Date();
  const today = todayInVietnam(now);
  await prisma.$transaction(
    async (tx) => {
      const users: [string, string, UserRole, string][] = [
        [demoIds.admin, 'admin', 'ADMIN', 'DEMO - Quản trị viên'],
        [
          demoIds.facilityUser,
          'facility',
          'HEALTHCARE_FACILITY',
          'DEMO - Cơ sở y tế',
        ],
        [demoIds.doctorUser, 'doctor', 'DOCTOR', 'DEMO - Bác sĩ gia đình'],
        [
          demoIds.familyUser,
          'family',
          'FAMILY_REP',
          'DEMO - Đại diện gia đình A',
        ],
        [
          demoIds.otherUser,
          'family2',
          'FAMILY_REP',
          'DEMO - Đại diện gia đình B',
        ],
      ];
      for (const [index, [id, email, role, fullName]] of users.entries()) {
        // Không đổi mật khẩu hoặc trạng thái tài khoản đã tồn tại khi chạy lại seed.
        const existingUser = await tx.user.findUnique({ where: { id } });
        if (
          existingUser &&
          existingUser.email !== `${email}@demo.famidoc.invalid`
        )
          throw new Error('Demo ID conflicts with a non-demo account');
        await tx.user.upsert({
          where: { id },
          update:
            process.env.RESET_DEMO_PASSWORD === '1' ? { passwordHash } : {},
          create: {
            id,
            email: `${email}@demo.famidoc.invalid`,
            phone: `+8490000000${index + 1}`,
            passwordHash,
            fullName,
            role,
            status: 'ACTIVE',
          },
        });
      }
      await tx.healthcareFacility.upsert({
        where: { id: demoIds.facility },
        update: {},
        create: {
          id: demoIds.facility,
          userId: demoIds.facilityUser,
          facilityName: 'DEMO - Cơ sở y tế kiểm thử',
          licenseNumber: 'DEMO-NOT-A-MEDICAL-LICENSE',
          taxCode: 'DEMO-NOT-A-TAX-ID',
          address: 'Địa chỉ giả dùng kiểm thử',
          hotline: '+84900000002',
          bankName: 'TEST_BANK',
          bankAccountNumber: '0000000000',
          bankAccountHolder: 'DEMO ONLY',
          verificationStatus: 'ACTIVE',
        },
      });
      await tx.doctor.upsert({
        where: { id: demoIds.doctor },
        update: {},
        create: {
          id: demoIds.doctor,
          userId: demoIds.doctorUser,
          facilityId: demoIds.facility,
          doctorName: 'DEMO - Bác sĩ kiểm thử',
          specialty: 'Y học gia đình - dữ liệu giả',
          experienceYears: 5,
          onboardingStatus: 'ACTIVE',
          maxPanelCapacity: 30,
        },
      });
      await tx.b2bStaffingContract.upsert({
        where: { contractCode: 'DEMO-B2B-001' },
        update: {},
        create: {
          contractCode: 'DEMO-B2B-001',
          facilityId: demoIds.facility,
          platformCommissionRate: 15,
          facilityRevenueRate: 85,
          startDate: new Date('2026-01-01T00:00:00Z'),
          endDate: new Date('2030-01-01T00:00:00Z'),
          status: 'ACTIVE',
        },
      });
      for (const [id, representativeUserId] of [
        [demoIds.family, demoIds.familyUser],
        [demoIds.otherFamily, demoIds.otherUser],
      ]) {
        await tx.familyUnit.upsert({
          where: { id },
          update: {},
          create: {
            id,
            representativeUserId,
            homeAddress: 'DEMO - Địa chỉ gia đình giả',
            emergencyPhone: '+84900000004',
          },
        });
      }
      for (let i = 1; i <= 5; i++) {
        await tx.patient.upsert({
          where: { id: `50000000-0000-4000-8000-00000000000${i}` },
          update: {},
          create: {
            id: `50000000-0000-4000-8000-00000000000${i}`,
            familyId: i <= 4 ? demoIds.family : demoIds.otherFamily,
            fullName: `DEMO - Thành viên giả ${i}`,
            dateOfBirth: new Date(`${i <= 2 ? 1960 : 1990}-01-01T00:00:00Z`),
            gender: 'OTHER',
            relationshipToHead: i === 1 || i === 5 ? 'SELF' : 'RELATIVE',
          },
        });
      }
      // Nguồn: bảng giá Drive 01_Bang_gia, 03_Them_nguoi. Giá đề xuất, chưa phải bảng giá thương mại.
      const packages = [
        {
          suffix: 1,
          code: 'TRAI_NGHIEM',
          name: 'Trải nghiệm',
          months: 1,
          members: 2,
          price: 1000000,
          home: 1,
          video: 2,
        },
        {
          suffix: 2,
          code: 'DONG_HANH',
          name: 'Đồng hành',
          months: 3,
          members: 4,
          price: 2850000,
          home: 3,
          video: 20,
        },
        {
          suffix: 3,
          code: 'TOAN_DIEN',
          name: 'Toàn diện',
          months: 12,
          members: 6,
          price: 13500000,
          home: 15,
          video: 96,
        },
      ];
      for (const item of packages) {
        await tx.servicePackage.upsert({
          where: { id: `70000000-0000-4000-8000-00000000000${item.suffix}` },
          update: {},
          create: {
            id: `70000000-0000-4000-8000-00000000000${item.suffix}`,
            packageCode: item.code,
            lineageCode: item.code,
            version: 1,
            packageName: item.name,
            description:
              'DỮ LIỆU MẪU - Giá dự thảo từ bảng giá Drive, không phải lời mời mua dịch vụ thật.',
            durationMonths: item.months,
            basePrice: item.price,
            periodicVisitsQuota: item.home,
            telehealthQuota: item.video,
            includedMembers: item.members,
            maxMembers: 6,
            additionalMemberMonthlyPrice: item.members < 6 ? 75000 : 0,
            quotaPeriod: 'PER_TERM',
            status: 'ACTIVE',
            publishedAt: now,
          },
        });
      }
      for (const [index, contractId, familyId, packageSuffix, active] of [
        [1, demoIds.pendingContract, demoIds.family, 2, false],
        [2, demoIds.activeContract, demoIds.otherFamily, 1, true],
      ] as const) {
        const p = await tx.servicePackage.findUniqueOrThrow({
          where: { id: `70000000-0000-4000-8000-00000000000${packageSuffix}` },
        });
        const quote = calculateCarePackageQuote(
          {
            id: p.id,
            code: p.lineageCode,
            version: p.version,
            name: p.packageName,
            description: p.description,
            durationMonths: p.durationMonths,
            priceVnd: Number(p.basePrice),
            includedMembers: p.includedMembers,
            maxMembers: p.maxMembers,
            additionalMemberMonthlyPriceVnd: Number(
              p.additionalMemberMonthlyPrice,
            ),
            currency: 'VND',
            quotaPeriod: QuotaPeriod.PER_TERM,
            quotas: {
              videoConsultations: p.telehealthQuota,
              homeVisits: p.periodicVisitsQuota,
              facilityVisits: 0,
            },
            status: CarePackageStatus.ACTIVE,
            createdAt: p.createdAt.toISOString(),
            updatedAt: p.updatedAt.toISOString(),
            publishedAt: p.publishedAt?.toISOString() ?? null,
            retiredAt: null,
          },
          active ? 1 : 4,
        );
        const snapshot = {
          package: quote.package,
          members: quote.members,
          pricing: quote.pricing,
          benefits: quote.benefits,
        };
        await tx.medicalContract.upsert({
          where: { id: contractId },
          update: {},
          create: {
            id: contractId,
            contractNumber: `DEMO-CONTRACT-00${index}`,
            familyId,
            facilityId: demoIds.facility,
            doctorId: demoIds.doctor,
            packageId: p.id,
            totalAmount: quote.pricing.totalPriceVnd,
            remainingHomeVisits: p.periodicVisitsQuota,
            remainingTelehealth: p.telehealthQuota,
            startDate: today,
            endDate: addContractMonths(today, p.durationMonths),
            contractStatus: active ? 'ACTIVE' : 'PENDING_PAYMENT',
            memberCount: quote.members.requestedCount,
            billingSnapshot: snapshot as unknown as Prisma.InputJsonValue,
            isDemo: true,
          },
        });
        // Fixture phục vụ test cổng điều kiện; tuyệt đối không coi đây là chữ ký điện tử pháp lý.
        const signers = [
          ['FAMILY_REP', active ? demoIds.otherUser : demoIds.familyUser],
          ['ADMIN', demoIds.admin],
          ['HEALTHCARE_FACILITY', demoIds.facilityUser],
          ['ASSIGNED_DOCTOR', demoIds.doctorUser],
        ] as const;
        for (const [signerRole, signerUserId] of signers) {
          const existing = await tx.contractSignature.findFirst({
            where: { contractId, addendumId: null, signerRole },
          });
          if (!existing)
            await tx.contractSignature.create({
              data: {
                contractId,
                signerRole,
                signerUserId,
                signatureHash: 'DEMO-FIXTURE-NOT-A-LEGAL-SIGNATURE',
                ipAddress: '127.0.0.1',
              },
            });
        }
      }
      // Một giao dịch TEST đã trả tiền để thử lịch sử. Không có giao dịch ngân hàng thật.
      const invoiceId = '90000000-0000-4000-8000-000000000001';
      const transactionId = 'a0000000-0000-4000-8000-000000000001';
      await tx.invoice.upsert({
        where: { id: invoiceId },
        update: {},
        create: {
          id: invoiceId,
          invoiceCode: 'FD00000000000040008000000000000001',
          contractId: demoIds.activeContract,
          grossAmount: 1000000,
          totalPayable: 1000000,
          paymentStatus: 'PENDING',
          paymentGateway: 'VIETQR_TEST',
          expectedAccountNumber: '0000000000',
          expectedGateway: 'TEST_BANK',
          expiredAt: new Date(now.getTime() + 15 * 60000),
        },
      });
      await tx.paymentTransaction.upsert({
        where: { id: transactionId },
        update: {},
        create: {
          id: transactionId,
          invoiceId,
          gatewayTransactionId: 'DEMO-SEED-PAID-001',
          amountReceived: 1000000,
          paymentTime: now,
          signatureVerified: true,
          webhookPayload: { demo: true, source: 'seed - not real bank money' },
          fingerprint: '0'.repeat(64),
          gateway: 'TEST_BANK',
          accountNumber: '0000000000',
          transferType: 'in',
          paymentCode: 'FD00000000000040008000000000000001',
          outcome: 'MATCHED',
        },
      });
      await tx.invoice.updateMany({
        where: { id: invoiceId, paymentStatus: 'PENDING' },
        data: {
          paymentStatus: 'PAID',
          paidAt: now,
          acceptedTransactionId: transactionId,
        },
      });
      const activePanelCount = await tx.medicalContract.count({
        where: { doctorId: demoIds.doctor, contractStatus: 'ACTIVE' },
      });
      await tx.doctor.update({
        where: { id: demoIds.doctor },
        data: { activePanelCount },
      });
      // Thông báo in-app dùng để test phân trang/quyền sở hữu; không gửi email/SMS.
      for (const [index, [userId]] of users.entries()) {
        const id = `b0000000-0000-4000-8000-00000000000${index + 1}`;
        await tx.notification.upsert({
          where: { id },
          update: {},
          create: {
            id,
            userId,
            title: 'DEMO - Chào mừng FamiDoc',
            content: 'Thông báo kiểm thử. Không có khoản thanh toán thật.',
            type: 'SYSTEM',
          },
        });
      }
      for (const [configKey, configValue] of [
        ['PLATFORM_COMMISSION_RATE', '15'],
        ['FACILITY_REVENUE_RATE', '85'],
        ['PAYMENT_TTL_MINUTES', '15'],
      ]) {
        await tx.systemConfiguration.upsert({
          where: { configKey },
          update: {},
          create: {
            configKey,
            configValue,
            description:
              'DEMO - Cấu hình theo tài liệu nghiệp vụ; không dùng để tự thực hiện chuyển tiền',
            updatedBy: demoIds.admin,
          },
        });
      }
    },
    { timeout: 30000 },
  );
  return demoIds;
}
if (require.main === module) {
  if (process.env.ALLOW_DEMO_SEED !== '1' || !process.env.DEMO_SEED_PASSWORD)
    throw new Error(
      'Explicit ALLOW_DEMO_SEED=1 and DEMO_SEED_PASSWORD are required',
    );
  const prisma = new PrismaClient();
  seedDemo(prisma, process.env.DEMO_SEED_PASSWORD)
    .then(async (ids) => {
      const { seedNamApiScenarios } =
        require('./seed-nam-scenarios') as typeof import('./seed-nam-scenarios');
      await seedNamApiScenarios(prisma);
      console.log('Demo data ready:', ids);
    })
    .catch(() => {
      console.error(
        'Demo seed failed. No credentials are logged; inspect database constraints and configuration.',
      );
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
