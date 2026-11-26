import { PrismaClient } from '@prisma/client';

// Test chạm DB thật: chỉ chạy khi RUN_DB_TESTS=1. Mỗi test chạy trong transaction rồi rollback.
const describeDb = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;

class Rollback extends Error {}

describeDb('doctor_slot_bookings schema', () => {
  const prisma = new PrismaClient();

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function inRollbackTx(
    fn: (tx: any, fixture: FixtureIds) => Promise<void>,
  ): Promise<void> {
    try {
      await prisma.$transaction(async (tx) => {
        const fixture = await loadFixture(tx);
        await fn(tx, fixture);
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
  }

  type FixtureIds = { doctorId: string; contractA: string; contractB: string };

  async function loadFixture(tx: any): Promise<FixtureIds> {
    const contracts: Array<{ id: string; doctorId: string }> =
      await tx.$queryRawUnsafe(
        `SELECT id, doctor_id AS "doctorId" FROM medical_contracts
         WHERE doctor_id IS NOT NULL AND contract_status = 'ACTIVE'
         ORDER BY created_at LIMIT 2`,
      );
    if (contracts.length < 2) throw new Error('Cần ≥2 hợp đồng ACTIVE trong DB');
    return {
      doctorId: contracts[0].doctorId,
      contractA: contracts[0].id,
      contractB: contracts[1].id,
    };
  }

  const insert = (
    tx: any,
    row: {
      doctorId: string;
      contractId: string;
      date: string;
      window: string;
      status?: string;
      holdExpiresAt?: string | null;
    },
  ) =>
    tx.$executeRawUnsafe(
      `INSERT INTO doctor_slot_bookings
        (doctor_id, slot_date, slot_window, contract_id, visit_type, status, hold_expires_at)
       VALUES ($1::uuid, $2::date, $3, $4::uuid, 'HOME_VISIT', $5, $6::timestamptz)`,
      row.doctorId,
      row.date,
      row.window,
      row.contractId,
      row.status ?? 'BOOKED',
      row.holdExpiresAt ?? null,
    );

  it('chặn 2 hợp đồng cùng (bác sĩ, ngày, ca)', async () => {
    await inRollbackTx(async (tx, f) => {
      await insert(tx, {
        doctorId: f.doctorId,
        contractId: f.contractA,
        date: '2026-12-01',
        window: 'MORNING',
      });
      await expect(
        insertSavepoint(tx, {
          doctorId: f.doctorId,
          contractId: f.contractB,
          date: '2026-12-01',
          window: 'MORNING',
        }),
      ).rejects.toThrow(/23505/);
    });
  });

  it('chặn 1 hợp đồng có 2 ca trong cùng ngày', async () => {
    await inRollbackTx(async (tx, f) => {
      await insert(tx, {
        doctorId: f.doctorId,
        contractId: f.contractA,
        date: '2026-12-01',
        window: 'MORNING',
      });
      await expect(
        insertSavepoint(tx, {
          doctorId: f.doctorId,
          contractId: f.contractA,
          date: '2026-12-01',
          window: 'AFTERNOON',
        }),
      ).rejects.toThrow(/23505/);
    });
  });

  it('HELD bắt buộc có hold_expires_at', async () => {
    await inRollbackTx(async (tx, f) => {
      await expect(
        insertSavepoint(tx, {
          doctorId: f.doctorId,
          contractId: f.contractA,
          date: '2026-12-01',
          window: 'MORNING',
          status: 'HELD',
          holdExpiresAt: null,
        }),
      ).rejects.toThrow(/check/i);
    });
  });

  it('hợp đồng kết thúc → xóa ca tương lai, giữ ca quá khứ', async () => {
    for (const endStatus of [
      'TERMINATED',
      'EXPIRED',
      'APPROVAL_REJECTED',
      'APPROVAL_EXPIRED',
    ]) {
      await inRollbackTx(async (tx, f) => {
        await insert(tx, {
          doctorId: f.doctorId,
          contractId: f.contractA,
          date: '2020-01-06',
          window: 'MORNING',
        });
        await insert(tx, {
          doctorId: f.doctorId,
          contractId: f.contractA,
          date: '2099-01-05',
          window: 'MORNING',
        });
        await insert(tx, {
          doctorId: f.doctorId,
          contractId: f.contractA,
          date: '2099-01-06',
          window: 'AFTERNOON',
        });
        await tx.$executeRawUnsafe(
          `UPDATE medical_contracts SET contract_status = '${endStatus}'::"MedicalContractStatus" WHERE id = $1::uuid`,
          f.contractA,
        );
        const rows: Array<{ slot_date: string }> = await tx.$queryRawUnsafe(
          `SELECT slot_date::text FROM doctor_slot_bookings WHERE contract_id = $1::uuid`,
          f.contractA,
        );
        expect(rows.map((r) => r.slot_date)).toEqual(['2020-01-06']);
      });
    }
  });

  it('hợp đồng vẫn ACTIVE → giữ nguyên ca', async () => {
    await inRollbackTx(async (tx, f) => {
      await insert(tx, {
        doctorId: f.doctorId,
        contractId: f.contractA,
        date: '2099-01-05',
        window: 'MORNING',
      });
      await tx.$executeRawUnsafe(
        `UPDATE medical_contracts SET updated_at = now() WHERE id = $1::uuid`,
        f.contractA,
      );
      const rows = await tx.$queryRawUnsafe(
        `SELECT 1 FROM doctor_slot_bookings WHERE contract_id = $1::uuid`,
        f.contractA,
      );
      expect(rows).toHaveLength(1);
    });
  });

  // Postgres hủy cả transaction sau lỗi; dùng SAVEPOINT để test tiếp tục sau khi bắt lỗi.
  async function insertSavepoint(tx: any, row: Parameters<typeof insert>[1]) {
    await tx.$executeRawUnsafe('SAVEPOINT sp');
    try {
      await insert(tx, row);
    } catch (error) {
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT sp');
      throw error;
    }
  }
});
