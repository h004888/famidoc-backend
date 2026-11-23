/** Kiểm tra trên DB demo local. Toàn bộ dữ liệu kiểm thử được rollback. */
import 'reflect-metadata';
import { PrismaClient } from '@prisma/client';
import type { PrismaService } from '../src/core/database/prisma.service';
import { PrescriptionsService } from '../src/modules/encounters/services/prescriptions.service';
import assert from 'node:assert/strict';

async function main() {
  const url = new URL(process.env.DATABASE_URL!);
  assert(
    ['localhost', '127.0.0.1'].includes(url.hostname) &&
      url.port === '55432' &&
      url.pathname === '/famidoc_payment_local',
    'Chỉ chạy trên DB demo local.',
  );
  const db = new PrismaClient();
  const rollback = new Error('EXPECTED_TEST_ROLLBACK');
  const checks: string[] = [];
  try {
    await db.$transaction(
      async (tx) => {
        const record = await tx.clinicalEmr.findFirstOrThrow({
          where: {
            encounter: { doctor: { user: { email: 'doctor@demo.famidoc.invalid' } } },
            isFinalized: true,
            prescriptions: { none: {} },
          },
          include: {
            patient: true,
            encounter: {
              include: { doctor: true, contract: { include: { familyUnit: true } } },
            },
          },
        });
        const { encounter: visit, patient } = record;
        const actor = {
          id: visit.doctor.userId,
          role: 'DOCTOR',
          familyUnitId: null,
        } as const;
        const familyActor = {
          id: visit.contract.familyUnit.representativeUserId,
          role: 'FAMILY_REP',
          familyUnitId: visit.contract.familyId,
        } as const;
        const service = new PrescriptionsService({
          $transaction: async (work: (client: typeof tx) => unknown) =>
            work(tx),
          prescription: tx.prescription,
          auditLog: tx.auditLog,
        } as unknown as PrismaService);
        const body = {
          recipientUserId: familyActor.id,
          recipientAuthorized: true as const,
          clinicalContext: {
            address: 'DỮ LIỆU KIỂM THỬ - ROLLBACK',
            phone: '0901234567',
            weightKg: 20,
            caregiverName: 'Người đưa trẻ kiểm thử',
          },
          details: [
            {
              medicationName: 'Thuốc kiểm thử - không sử dụng',
              activeIngredient: 'Hoạt chất kiểm thử',
              strength: 'Dữ liệu kiểm thử',
              dosage: 'Dữ liệu kiểm thử',
              administrationRoute: 'Dữ liệu kiểm thử',
              frequency: 'Dữ liệu kiểm thử',
              quantity: 6,
              unit: 'Đơn vị',
              durationDays: 3,
            },
          ],
        };
        const original = await service.share(actor, visit.id, { ...body, patientId: patient.id });
        const saved = await service.familyDetail(familyActor, original.id);
        assert(
          saved.recordSnapshot?.patient.fullName === patient.fullName,
        );
        assert(saved.details[0].quantity === 6 && saved.validUntil);
        checks.push('save_and_read_prescription');
        await tx.patient.update({
          where: { id: patient.id },
          data: { fullName: 'Tên hồ sơ thay đổi trong kiểm thử' },
        });
        assert(
          (await service.familyDetail(familyActor, original.id)).patient
            .fullName === patient.fullName,
        );
        checks.push('historical_header_is_frozen');
        const replacement = await service.replace(actor, original.id, {
          ...body,
          replacementReason: 'Lý do kiểm thử thay thế, không dùng điều trị.',
        });
        const old = await service.familyDetail(familyActor, original.id);
        assert(
          old.status === 'CANCELLED' && old.replacedBy?.id === replacement.id,
        );
        assert(
          (await service.familyDetail(familyActor, replacement.id)).replaces
            ?.id === original.id,
        );
        checks.push('replacement_links_and_old_content_retained');
        await assert.rejects(
          service.replace(actor, original.id, {
            ...body,
            replacementReason: 'Không được thay thế một bản đã bị thay thế.',
          }),
        );
        await assert.rejects(
          service.familyDetail(
            { ...familyActor, id: '10000000-0000-4000-8000-999999999999' },
            replacement.id,
          ),
        );
        checks.push('reject_stale_replacement_and_wrong_recipient');
        const exported = await service.exportRecord(actor, replacement.id);
        assert(
          exported.format === 'FAMIDOC_PRESCRIPTION_V1' &&
            exported.recordSnapshot,
        );
        checks.push('authorized_export');
        await tx.$executeRawUnsafe('SAVEPOINT prescription_immutable');
        await assert.rejects(
          tx.prescription.update({
            where: { id: original.id },
            data: { instructions: 'Không được sửa đè' },
          }),
        );
        await tx.$executeRawUnsafe(
          'ROLLBACK TO SAVEPOINT prescription_immutable',
        );
        await assert.rejects(
          tx.prescriptionDetail.deleteMany({
            where: { prescriptionId: original.id },
          }),
        );
        await tx.$executeRawUnsafe(
          'ROLLBACK TO SAVEPOINT prescription_immutable',
        );
        checks.push('database_blocks_overwrite_and_detail_deletion');
        const before = await tx.prescription.count({
          where: { id: { in: [original.id, replacement.id] } },
        });
        await assert.rejects(
          service.replace(actor, replacement.id, {
            ...body,
            recipientUserId: '10000000-0000-4000-8000-999999999999',
            replacementReason: 'Kiểm thử người nhận không hợp lệ.',
          }),
        );
        assert(
          (
            await tx.prescription.findUniqueOrThrow({
              where: { id: replacement.id },
            })
          ).status === 'ISSUED',
        );
        assert(before === 2);
        checks.push('failed_replacement_keeps_current_prescription');
        throw rollback;
      },
      { isolationLevel: 'Serializable', timeout: 30000 },
    );
  } catch (error) {
    if (error !== rollback) throw error;
    console.log(
      JSON.stringify({
        checks,
        count: checks.length,
        allTestDataRolledBack: true,
      }),
    );
  } finally {
    await db.$disconnect();
  }
}
void main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
