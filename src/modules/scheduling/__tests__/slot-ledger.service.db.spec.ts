import { ConflictException } from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';
import { SlotLedgerService } from '../slot-ledger.service';

// Test chạm DB thật: chỉ chạy khi RUN_DB_TESTS=1. Mỗi test chạy trong transaction rồi rollback.
const describeDb = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;

class Rollback extends Error {}

type Fixture = {
  doctorId: string;
  contractX: string;
  contractY: string;
  encounterX: string;
};

describeDb('SlotLedgerService', () => {
  const prisma = new PrismaClient();
  const ledger = new SlotLedgerService();

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function inRollbackTx(
    fn: (tx: Prisma.TransactionClient, f: Fixture) => Promise<void>,
  ): Promise<void> {
    try {
      await prisma.$transaction(async (tx) => {
        const withEncounter: Array<{
          id: string;
          doctorId: string;
          encounterId: string;
        }> = await tx.$queryRawUnsafe(
          `SELECT c.id, c.doctor_id AS "doctorId", e.id AS "encounterId"
           FROM medical_contracts c JOIN encounters e ON e.contract_id = c.id
           WHERE c.doctor_id IS NOT NULL
           ORDER BY c.created_at LIMIT 1`,
        );
        const other: Array<{ id: string }> = await tx.$queryRawUnsafe(
          `SELECT id FROM medical_contracts WHERE id <> $1::uuid AND doctor_id IS NOT NULL
           ORDER BY created_at LIMIT 1`,
          withEncounter[0].id,
        );
        // Encounter đang gắn ledger (nếu có) phải được gỡ để test độc lập.
        await tx.$executeRawUnsafe(
          `DELETE FROM doctor_slot_bookings WHERE encounter_id = $1::uuid`,
          withEncounter[0].encounterId,
        );
        await fn(tx, {
          doctorId: withEncounter[0].doctorId,
          contractX: withEncounter[0].id,
          contractY: other[0].id,
          encounterX: withEncounter[0].encounterId,
        });
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
  }

  const future = new Date(Date.now() + 24 * 3600 * 1000);
  const past = new Date(Date.now() - 24 * 3600 * 1000);

  async function expectSlotTaken(promise: Promise<unknown>) {
    const error = await promise.then(
      () => null,
      (e) => e,
    );
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({
      code: 'SLOT_TAKEN',
    });
  }

  it('hold trùng ca với hợp đồng khác → SLOT_TAKEN', async () => {
    await inRollbackTx(async (tx, f) => {
      await ledger.hold(tx, {
        doctorId: f.doctorId,
        contractId: f.contractX,
        expiresAt: future,
        slots: [
          { date: '2099-03-02', slotWindow: 'MORNING', visitType: 'HOME_VISIT' },
          { date: '2099-03-09', slotWindow: 'AFTERNOON', visitType: 'VIDEO' },
        ],
      });
      await tx.$executeRawUnsafe('SAVEPOINT sp');
      await expectSlotTaken(
        ledger.hold(tx, {
          doctorId: f.doctorId,
          contractId: f.contractY,
          expiresAt: future,
          slots: [
            { date: '2099-03-02', slotWindow: 'MORNING', visitType: 'HOME_VISIT' },
          ],
        }),
      );
    });
  });

  it('HELD hết hạn không chặn hold của hợp đồng khác', async () => {
    await inRollbackTx(async (tx, f) => {
      await ledger.hold(tx, {
        doctorId: f.doctorId,
        contractId: f.contractX,
        expiresAt: past,
        slots: [
          { date: '2099-03-02', slotWindow: 'MORNING', visitType: 'HOME_VISIT' },
        ],
      });
      await ledger.hold(tx, {
        doctorId: f.doctorId,
        contractId: f.contractY,
        expiresAt: future,
        slots: [
          { date: '2099-03-02', slotWindow: 'MORNING', visitType: 'HOME_VISIT' },
        ],
      });
      const occupied = await ledger.listOccupied(
        tx,
        f.doctorId,
        '2099-03-01',
        '2099-03-31',
      );
      expect(occupied).toHaveLength(1);
      expect(occupied[0].contractId).toBe(f.contractY);
    });
  });

  it('listOccupied bỏ HELD hết hạn và bỏ qua excludeContractId', async () => {
    await inRollbackTx(async (tx, f) => {
      await ledger.hold(tx, {
        doctorId: f.doctorId,
        contractId: f.contractX,
        expiresAt: past,
        slots: [
          { date: '2099-03-02', slotWindow: 'MORNING', visitType: 'HOME_VISIT' },
        ],
      });
      await ledger.hold(tx, {
        doctorId: f.doctorId,
        contractId: f.contractY,
        expiresAt: future,
        slots: [
          { date: '2099-03-03', slotWindow: 'AFTERNOON', visitType: 'VIDEO' },
        ],
      });
      expect(
        await ledger.listOccupied(tx, f.doctorId, '2099-03-01', '2099-03-31'),
      ).toHaveLength(1);
      expect(
        await ledger.listOccupied(tx, f.doctorId, '2099-03-01', '2099-03-31', {
          excludeContractId: f.contractY,
        }),
      ).toHaveLength(0);
    });
  });

  it('confirmContract với opts nhả ca HELD sai bác sĩ hoặc đã qua ngày tối thiểu', async () => {
    await inRollbackTx(async (tx, f) => {
      await ledger.hold(tx, {
        doctorId: f.doctorId,
        contractId: f.contractX,
        expiresAt: future,
        slots: [
          { date: '2099-03-02', slotWindow: 'MORNING', visitType: 'HOME_VISIT' },
          { date: '2000-01-03', slotWindow: 'MORNING', visitType: 'VIDEO' },
        ],
      });
      const bookings = await ledger.confirmContract(tx, f.contractX, {
        doctorId: f.doctorId,
        minDate: '2099-01-01',
      });
      expect(bookings.map((b) => b.date)).toEqual(['2099-03-02']);
      const left: Array<{ n: number }> = await tx.$queryRawUnsafe(
        `SELECT count(*)::int AS n FROM doctor_slot_bookings
         WHERE contract_id = $1::uuid AND slot_date = '2000-01-03'::date`,
        f.contractX,
      );
      expect(left[0].n).toBe(0);
    });
  });

  it('confirmContract chuyển HELD → BOOKED và xóa hold_expires_at', async () => {
    await inRollbackTx(async (tx, f) => {
      await ledger.hold(tx, {
        doctorId: f.doctorId,
        contractId: f.contractX,
        expiresAt: future,
        slots: [
          { date: '2099-03-02', slotWindow: 'MORNING', visitType: 'HOME_VISIT' },
          { date: '2099-03-09', slotWindow: 'MORNING', visitType: 'VIDEO' },
        ],
      });
      const bookings = await ledger.confirmContract(tx, f.contractX);
      expect(bookings).toHaveLength(2);
      const rows: Array<{ status: string; hold: Date | null }> =
        await tx.$queryRawUnsafe(
          `SELECT status, hold_expires_at AS hold FROM doctor_slot_bookings WHERE contract_id = $1::uuid`,
          f.contractX,
        );
      expect(rows.every((r) => r.status === 'BOOKED' && r.hold === null)).toBe(
        true,
      );
    });
  });

  it('move sang ca đã có người → SLOT_TAKEN, ca cũ giữ nguyên', async () => {
    await inRollbackTx(async (tx, f) => {
      await ledger.book(tx, {
        doctorId: f.doctorId,
        contractId: f.contractX,
        date: '2099-03-02',
        slotWindow: 'MORNING',
        visitType: 'HOME_VISIT',
        encounterId: f.encounterX,
      });
      await ledger.book(tx, {
        doctorId: f.doctorId,
        contractId: f.contractY,
        date: '2099-03-03',
        slotWindow: 'MORNING',
        visitType: 'HOME_VISIT',
      });
      await expectSlotTaken(
        ledger.move(tx, f.encounterX, {
          date: '2099-03-03',
          slotWindow: 'MORNING',
        }),
      );
      const rows: Array<{ slot_date: string }> = await tx.$queryRawUnsafe(
        `SELECT slot_date::text FROM doctor_slot_bookings WHERE encounter_id = $1::uuid`,
        f.encounterX,
      );
      expect(rows.map((r) => r.slot_date)).toEqual(['2099-03-02']);
    });
  });

  it('move encounter chưa có booking (legacy) → tạo booking mới và vẫn chặn trùng ca', async () => {
    await inRollbackTx(async (tx, f) => {
      await ledger.book(tx, {
        doctorId: f.doctorId,
        contractId: f.contractY,
        date: '2099-03-05',
        slotWindow: 'MORNING',
        visitType: 'HOME_VISIT',
      });
      await ledger.move(tx, f.encounterX, { date: '2099-03-04', slotWindow: 'MORNING' });
      const rows: Array<{ slot_date: string }> = await tx.$queryRawUnsafe(
        `SELECT slot_date::text FROM doctor_slot_bookings WHERE encounter_id = $1::uuid`,
        f.encounterX,
      );
      expect(rows.map((r) => r.slot_date)).toEqual(['2099-03-04']);
      await expectSlotTaken(
        ledger.move(tx, f.encounterX, { date: '2099-03-05', slotWindow: 'MORNING' }),
      );
    });
  });

  it('releaseEncounter trả ca trống; hợp đồng khác book được', async () => {
    await inRollbackTx(async (tx, f) => {
      await ledger.book(tx, {
        doctorId: f.doctorId,
        contractId: f.contractX,
        date: '2099-03-02',
        slotWindow: 'MORNING',
        visitType: 'HOME_VISIT',
        encounterId: f.encounterX,
      });
      await ledger.releaseEncounter(tx, f.encounterX);
      await ledger.book(tx, {
        doctorId: f.doctorId,
        contractId: f.contractY,
        date: '2099-03-02',
        slotWindow: 'MORNING',
        visitType: 'HOME_VISIT',
      });
      const occupied = await ledger.listOccupied(
        tx,
        f.doctorId,
        '2099-03-01',
        '2099-03-31',
      );
      expect(occupied.map((o: { contractId: string }) => o.contractId)).toEqual([f.contractY]);
    });
  });

  it('releaseContractHolds chỉ xóa HELD, giữ BOOKED', async () => {
    await inRollbackTx(async (tx, f) => {
      await ledger.book(tx, {
        doctorId: f.doctorId,
        contractId: f.contractX,
        date: '2099-03-02',
        slotWindow: 'MORNING',
        visitType: 'HOME_VISIT',
      });
      await ledger.hold(tx, {
        doctorId: f.doctorId,
        contractId: f.contractX,
        expiresAt: future,
        slots: [
          { date: '2099-03-09', slotWindow: 'MORNING', visitType: 'VIDEO' },
        ],
      });
      await ledger.releaseContractHolds(tx, f.contractX);
      const occupied = await ledger.listOccupied(
        tx,
        f.doctorId,
        '2099-03-01',
        '2099-03-31',
      );
      expect(occupied.map((o: { status: string }) => o.status)).toEqual(['BOOKED']);
    });
  });
});
