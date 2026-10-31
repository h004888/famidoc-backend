import { Prisma, PrismaClient } from '@prisma/client';
import { demoIds } from './seed';
import {
  todayInVietnam,
  getVietnamMonthWindow,
} from '../src/core/business/business-helpers';
export const namScenarioIds = {
  completedEncounter: '80000000-0000-4000-8000-000000000001',
  pendingEncounter: '80000000-0000-4000-8000-000000000002',
  historicalContract: '60000000-0000-4000-8000-000000000003',
  historicalInvoice: '90000000-0000-4000-8000-000000000003',
  historicalTransaction: 'a0000000-0000-4000-8000-000000000003',
};
export async function seedNamApiScenarios(prisma: PrismaClient) {
  const today = todayInVietnam();
  await prisma.$transaction(
    async (tx) => {
      for (let n = 6; n <= 7; n++)
        await tx.patient.upsert({
          where: { id: `50000000-0000-4000-8000-00000000000${n}` },
          update: {},
          create: {
            id: `50000000-0000-4000-8000-00000000000${n}`,
            familyId: demoIds.otherFamily,
            fullName: `DEMO - Người bổ sung ${n}`,
            dateOfBirth: new Date('1991-01-01T00:00:00Z'),
            gender: 'OTHER',
            relationshipToHead: 'RELATIVE',
            status: 'INACTIVE', // Hồ sơ mẫu chưa tham gia dịch vụ; test sẽ kích hoạt khi gia đình thêm người.
          },
        });
      for (const [id, status] of [
        [namScenarioIds.completedEncounter, 'COMPLETED'],
        [namScenarioIds.pendingEncounter, 'REQUESTED'],
      ] as const) {
        await tx.encounter.upsert({
          where: { id },
          update: {},
          create: {
            id,
            contractId: demoIds.activeContract,
            patientId: '50000000-0000-4000-8000-000000000005',
            doctorId: demoIds.doctor,
            encounterType: 'HOME_VISIT',
            category: 'PERIODIC_ROUTINE',
            scheduledDate: today,
            scheduledTime: new Date('1970-01-01T09:00:00Z'),
            encounterStatus: status,
          },
        });
      }
      const current = new Date(Date.now() + 7 * 3600000);
      current.setUTCDate(1);
      current.setUTCMonth(current.getUTCMonth() - 1);
      const year = current.getUTCFullYear(),
        month = current.getUTCMonth() + 1;
      const period = getVietnamMonthWindow(year, month),
        paidAt = new Date(period.start.getTime() + 86400000);
      const source = await tx.medicalContract.findUniqueOrThrow({
        where: { id: demoIds.activeContract },
      });
      const start = new Date(Date.UTC(year, month - 1, 1)),
        end = new Date(Date.UTC(year, month, 1));
      await tx.medicalContract.upsert({
        where: { id: namScenarioIds.historicalContract },
        update: {},
        create: {
          id: namScenarioIds.historicalContract,
          contractNumber: 'DEMO-HISTORICAL-MONTH',
          familyId: source.familyId,
          facilityId: source.facilityId,
          doctorId: source.doctorId,
          packageId: source.packageId,
          totalAmount: 1000000,
          remainingHomeVisits: 0,
          remainingTelehealth: 0,
          startDate: start,
          endDate: end,
          contractStatus: 'EXPIRED',
          memberCount: source.memberCount,
          billingSnapshot: source.billingSnapshot as Prisma.InputJsonValue,
          isDemo: true,
        },
      });
      await tx.invoice.upsert({
        where: { id: namScenarioIds.historicalInvoice },
        update: {},
        create: {
          id: namScenarioIds.historicalInvoice,
          invoiceCode: 'FD00000000000040008000000000000003',
          contractId: namScenarioIds.historicalContract,
          grossAmount: 1000000,
          totalPayable: 1000000,
          environment: 'TEST',
          paymentGateway: 'VIETQR_TEST',
          createdAt: new Date(paidAt.getTime() - 60000),
          expiredAt: new Date(paidAt.getTime() + 14 * 60000),
          expectedAccountNumber: '0000000000',
          expectedGateway: 'TEST_BANK',
        },
      });
      // Dòng lịch sử giả để thử quyết toán kỳ trước, không phải webhook hay tiền ngân hàng thật.
      await tx.paymentTransaction.upsert({
        where: { id: namScenarioIds.historicalTransaction },
        update: {},
        create: {
          id: namScenarioIds.historicalTransaction,
          invoiceId: namScenarioIds.historicalInvoice,
          gatewayTransactionId: 'DEMO-HISTORICAL-PAID',
          amountReceived: 1000000,
          paymentTime: paidAt,
          signatureVerified: true,
          webhookPayload: { demo: true, notRealBankMoney: true },
          fingerprint: '0'.repeat(64),
          gateway: 'TEST_BANK',
          accountNumber: '0000000000',
          transferType: 'in',
          outcome: 'MATCHED',
          environment: 'TEST',
          createdAt: paidAt,
        },
      });
      await tx.invoice.updateMany({
        where: {
          id: namScenarioIds.historicalInvoice,
          paymentStatus: 'PENDING',
        },
        data: {
          paymentStatus: 'PAID',
          acceptedTransactionId: namScenarioIds.historicalTransaction,
          paidAt,
        },
      });
    },
    { timeout: 30000 },
  );
  return namScenarioIds;
}
