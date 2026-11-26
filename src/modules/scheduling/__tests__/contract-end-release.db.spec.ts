import { PrismaClient, EncounterStatus } from '@prisma/client';
import { PrismaContractsSession } from '../../contracts/repositories/impl/contracts.repository.impl';

const describeDb = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;

class Rollback extends Error {}

describeDb('Task 11: Contract end release + cancel future encounters (DB)', () => {
  const prisma = new PrismaClient();

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function inRollbackTx(
    fn: (tx: any, fixture: { contractId: string; doctorId: string }) => Promise<void>,
  ): Promise<void> {
    try {
      await prisma.$transaction(async (tx) => {
        const contracts: Array<{ id: string; doctorId: string }> =
          await tx.$queryRawUnsafe(
            `SELECT id, doctor_id AS "doctorId" FROM medical_contracts
             WHERE doctor_id IS NOT NULL AND contract_status = 'ACTIVE'
             ORDER BY created_at LIMIT 1`,
          );
        if (contracts.length === 0) throw new Error('Cần ≥1 hợp đồng ACTIVE trong DB');
        const { id: contractId, doctorId } = contracts[0];

        // Dọn booking/encounter thử nghiệm của contractId trong tx
        await tx.$executeRawUnsafe(
          `DELETE FROM doctor_slot_bookings WHERE contract_id = $1::uuid`,
          contractId,
        );

        await fn(tx, { contractId, doctorId });
        throw new Rollback();
      });
    } catch (err) {
      if (!(err instanceof Rollback)) throw err;
    }
  }

  async function seedBookingsAndEncounters(
    tx: any,
    contractId: string,
    doctorId: string,
  ) {
    const encPast = await tx.encounter.create({
      data: {
        contractId,
        doctorId,
        encounterType: 'HOME_VISIT',
        category: 'PERIODIC_ROUTINE',
        visitScope: 'FAMILY',
        scheduledDate: new Date('2020-01-06T00:00:00.000Z'),
        scheduledTime: new Date('1970-01-01T08:00:00.000Z'),
        slotWindow: 'MORNING',
        encounterStatus: EncounterStatus.CONFIRMED,
      },
    });
    const encFuture1 = await tx.encounter.create({
      data: {
        contractId,
        doctorId,
        encounterType: 'HOME_VISIT',
        category: 'PERIODIC_ROUTINE',
        visitScope: 'FAMILY',
        scheduledDate: new Date('2099-06-01T00:00:00.000Z'),
        scheduledTime: new Date('1970-01-01T08:00:00.000Z'),
        slotWindow: 'MORNING',
        encounterStatus: EncounterStatus.CONFIRMED,
      },
    });
    const encFuture2 = await tx.encounter.create({
      data: {
        contractId,
        doctorId,
        encounterType: 'TELEHEALTH',
        category: 'AD_HOC_ON_DEMAND',
        visitScope: 'FAMILY',
        scheduledDate: new Date('2099-06-08T00:00:00.000Z'),
        scheduledTime: new Date('1970-01-01T13:30:00.000Z'),
        slotWindow: 'AFTERNOON',
        encounterStatus: EncounterStatus.REQUESTED,
      },
    });

    await tx.$executeRawUnsafe(
      `INSERT INTO doctor_slot_bookings
         (doctor_id, slot_date, slot_window, contract_id, encounter_id, visit_type, status)
       VALUES
         ($1::uuid, '2020-01-06'::date, 'MORNING', $2::uuid, $3::uuid, 'HOME_VISIT', 'BOOKED'),
         ($1::uuid, '2099-06-01'::date, 'MORNING', $2::uuid, $4::uuid, 'HOME_VISIT', 'BOOKED'),
         ($1::uuid, '2099-06-08'::date, 'AFTERNOON', $2::uuid, $5::uuid, 'VIDEO', 'BOOKED')`,
      doctorId,
      contractId,
      encPast.id,
      encFuture1.id,
      encFuture2.id,
    );

    return { encPast, encFuture1, encFuture2 };
  }

  it('updateContractStatus(EXPIRED) → xóa 2 booking tương lai (còn 1 quá khứ) và hủy encounter tương lai', async () => {
    await inRollbackTx(async (tx, { contractId, doctorId }) => {
      const { encFuture1, encFuture2 } = await seedBookingsAndEncounters(
        tx,
        contractId,
        doctorId,
      );
      const session = new PrismaContractsSession(tx);
      await session.updateContractStatus(contractId, 'EXPIRED');

      const remaining: Array<{ count: number }> = await tx.$queryRawUnsafe(
        `SELECT COUNT(*)::int AS count FROM doctor_slot_bookings WHERE contract_id = $1::uuid`,
        contractId,
      );
      expect(remaining[0].count).toBe(1);

      const f1 = await tx.encounter.findUnique({ where: { id: encFuture1.id } });
      const f2 = await tx.encounter.findUnique({ where: { id: encFuture2.id } });
      expect(f1.encounterStatus).toBe(EncounterStatus.CANCELLED);
      expect(f2.encounterStatus).toBe(EncounterStatus.CANCELLED);
    });
  });

  it('updateContractStatus(TERMINATED) → xóa 2 booking tương lai (còn 1 quá khứ) và hủy encounter tương lai', async () => {
    await inRollbackTx(async (tx, { contractId, doctorId }) => {
      const { encFuture1, encFuture2 } = await seedBookingsAndEncounters(
        tx,
        contractId,
        doctorId,
      );
      const session = new PrismaContractsSession(tx);
      await session.updateContractStatus(contractId, 'TERMINATED', 'Hủy test');

      const remaining: Array<{ count: number }> = await tx.$queryRawUnsafe(
        `SELECT COUNT(*)::int AS count FROM doctor_slot_bookings WHERE contract_id = $1::uuid`,
        contractId,
      );
      expect(remaining[0].count).toBe(1);

      const f1 = await tx.encounter.findUnique({ where: { id: encFuture1.id } });
      const f2 = await tx.encounter.findUnique({ where: { id: encFuture2.id } });
      expect(f1.encounterStatus).toBe(EncounterStatus.CANCELLED);
      expect(f2.encounterStatus).toBe(EncounterStatus.CANCELLED);
    });
  });

  it('updateContractStatus(PENDING_PAYMENT) → giữ nguyên cả 3 booking và không hủy encounter', async () => {
    await inRollbackTx(async (tx, { contractId, doctorId }) => {
      const { encFuture1 } = await seedBookingsAndEncounters(tx, contractId, doctorId);
      const session = new PrismaContractsSession(tx);
      await session.updateContractStatus(contractId, 'PENDING_PAYMENT');

      const remaining: Array<{ count: number }> = await tx.$queryRawUnsafe(
        `SELECT COUNT(*)::int AS count FROM doctor_slot_bookings WHERE contract_id = $1::uuid`,
        contractId,
      );
      expect(remaining[0].count).toBe(3);

      const f1 = await tx.encounter.findUnique({ where: { id: encFuture1.id } });
      expect(f1.encounterStatus).toBe(EncounterStatus.CONFIRMED);
    });
  });
});
