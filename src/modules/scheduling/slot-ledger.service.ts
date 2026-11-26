import { ConflictException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

export type SlotWindowName = 'MORNING' | 'AFTERNOON';
export type SlotVisitType = 'HOME_VISIT' | 'VIDEO';

export type OccupiedSlot = {
  date: string;
  slotWindow: SlotWindowName;
  contractId: string;
  status: 'HELD' | 'BOOKED';
};

export type SlotRequest = {
  date: string;
  slotWindow: SlotWindowName;
  visitType: SlotVisitType;
};

export type BookingRow = SlotRequest & {
  id: string;
  doctorId: string;
  contractId: string;
  encounterId: string | null;
  status: 'HELD' | 'BOOKED';
};

type Tx = Prisma.TransactionClient;

/**
 * Chuyển lỗi vi phạm UNIQUE (Prisma P2002 / Postgres 23505) thành 409 SLOT_TAKEN
 * để mọi đường đặt/dời ca trả cùng một mã lỗi cho client.
 */
export function mapUniqueViolation(
  error: unknown,
  slot: { date: string; slotWindow: string },
): never {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: string } | null)?.code;
  if (code === 'P2002' || /23505|duplicate key|already exists/i.test(message)) {
    throw new ConflictException({
      code: 'SLOT_TAKEN',
      message: 'Ca này vừa có người đặt, vui lòng chọn ca khác',
      date: slot.date,
      slotWindow: slot.slotWindow,
    });
  }
  throw error;
}

/**
 * Sổ cái ca khám: nguồn sự thật duy nhất cho việc "ca nào của bác sĩ đã có người".
 * Ràng buộc UNIQUE ở DB bảo đảm không thể có 2 gia đình cùng một ca, kể cả khi đặt đồng thời.
 */
@Injectable()
export class SlotLedgerService {
  async listOccupied(
    tx: Tx,
    doctorId: string,
    from: string,
    to: string,
    opts: { excludeContractId?: string } = {},
  ): Promise<OccupiedSlot[]> {
    const rows = await tx.$queryRawUnsafe<
      Array<{
        date: string;
        slotWindow: SlotWindowName;
        contractId: string;
        status: 'HELD' | 'BOOKED';
      }>
    >(
      `SELECT slot_date::text AS date, slot_window AS "slotWindow",
              contract_id AS "contractId", status
       FROM doctor_slot_bookings
       WHERE doctor_id = $1::uuid
         AND slot_date >= $2::date AND slot_date <= $3::date
         AND ($4::uuid IS NULL OR contract_id <> $4::uuid)
         AND (status = 'BOOKED' OR hold_expires_at > now())
       ORDER BY slot_date, slot_window`,
      doctorId,
      from,
      to,
      opts.excludeContractId ?? null,
    );
    return rows;
  }

  async hold(
    tx: Tx,
    input: {
      doctorId: string;
      contractId: string;
      slots: SlotRequest[];
      expiresAt: Date;
    },
  ): Promise<void> {
    for (const slot of input.slots) {
      // Xóa HELD đã hết hạn đang chiếm đúng ca này để người khác có thể giữ.
      await tx.$executeRawUnsafe(
        `DELETE FROM doctor_slot_bookings
         WHERE doctor_id = $1::uuid AND slot_date = $2::date AND slot_window = $3
           AND status = 'HELD' AND hold_expires_at <= now()`,
        input.doctorId,
        slot.date,
        slot.slotWindow,
      );
      await this.insertRow(tx, {
        doctorId: input.doctorId,
        contractId: input.contractId,
        slot,
        status: 'HELD',
        expiresAt: input.expiresAt,
        encounterId: null,
      });
    }
  }

  /** Ngày gia đình đã có lượt khám (booking/hold còn hiệu lực) ở bất kỳ hợp đồng nào khác. */
  async listFamilyBusyDates(
    tx: Prisma.TransactionClient,
    familyId: string,
    from: string,
    to: string,
    opts: { excludeContractId?: string } = {},
  ): Promise<string[]> {
    const rows = await tx.$queryRawUnsafe<Array<{ d: string }>>(
      `SELECT DISTINCT b.slot_date::text AS d
         FROM doctor_slot_bookings b
         JOIN medical_contracts c ON c.id = b.contract_id
        WHERE c.family_id = $1::uuid
          AND b.slot_date >= $2::date AND b.slot_date <= $3::date
          AND ($4::uuid IS NULL OR b.contract_id <> $4::uuid)
          AND (b.status = 'BOOKED' OR b.hold_expires_at > now())`,
      familyId,
      from,
      to,
      opts.excludeContractId ?? null,
    );
    return rows.map((r) => r.d);
  }

  /**
   * Xác nhận các ca đang giữ của hợp đồng. Khi truyền `opts`, các ca HELD sai bác sĩ
   * hoặc đã qua/ngay hôm nay (`slot_date < minDate`) bị nhả trước, không được xác nhận.
   */
  async confirmContract(
    tx: Tx,
    contractId: string,
    opts: { doctorId?: string; minDate?: string } = {},
  ): Promise<BookingRow[]> {
    if (opts.doctorId) {
      await tx.$executeRawUnsafe(
        `DELETE FROM doctor_slot_bookings
         WHERE contract_id = $1::uuid AND status = 'HELD'
           AND doctor_id <> $2::uuid`,
        contractId,
        opts.doctorId,
      );
    }
    if (opts.minDate) {
      await tx.$executeRawUnsafe(
        `DELETE FROM doctor_slot_bookings
         WHERE contract_id = $1::uuid AND status = 'HELD'
           AND slot_date < $2::date`,
        contractId,
        opts.minDate,
      );
    }
    return tx.$queryRawUnsafe<BookingRow[]>(
      `UPDATE doctor_slot_bookings
       SET status = 'BOOKED', hold_expires_at = NULL
       WHERE contract_id = $1::uuid AND status = 'HELD'
       RETURNING id, doctor_id AS "doctorId", contract_id AS "contractId",
                 encounter_id AS "encounterId", slot_date::text AS date,
                 slot_window AS "slotWindow", visit_type AS "visitType", status`,
      contractId,
    );
  }

  async attachEncounter(
    tx: Tx,
    bookingId: string,
    encounterId: string,
  ): Promise<void> {
    await tx.$executeRawUnsafe(
      `UPDATE doctor_slot_bookings SET encounter_id = $2::uuid WHERE id = $1::uuid`,
      bookingId,
      encounterId,
    );
  }

  async book(
    tx: Tx,
    input: {
      doctorId: string;
      contractId: string;
      date: string;
      slotWindow: SlotWindowName;
      visitType: SlotVisitType;
      encounterId?: string | null;
    },
  ): Promise<void> {
    // Chỉ dọn HELD hết hạn đang chiếm ca này; BOOKED / HELD còn hạn vẫn chặn bằng UNIQUE.
    await tx.$executeRawUnsafe(
      `DELETE FROM doctor_slot_bookings
       WHERE doctor_id = $1::uuid AND slot_date = $2::date AND slot_window = $3
         AND status = 'HELD' AND hold_expires_at <= now()`,
      input.doctorId,
      input.date,
      input.slotWindow,
    );
    await this.insertRow(tx, {
      doctorId: input.doctorId,
      contractId: input.contractId,
      slot: {
        date: input.date,
        slotWindow: input.slotWindow,
        visitType: input.visitType,
      },
      status: 'BOOKED',
      expiresAt: null,
      encounterId: input.encounterId ?? null,
    });
  }

  async move(
    tx: Tx,
    encounterId: string,
    target: { date: string; slotWindow: SlotWindowName },
  ): Promise<void> {
    try {
      await tx.$executeRawUnsafe('SAVEPOINT slot_ledger_move');
      const updated = await tx.$executeRawUnsafe(
        `UPDATE doctor_slot_bookings SET slot_date = $2::date, slot_window = $3
         WHERE encounter_id = $1::uuid`,
        encounterId,
        target.date,
        target.slotWindow,
      );
      if (Number(updated) === 0) {
        // Encounter cũ chưa có dòng trong sổ cái → tạo mới để vẫn được UNIQUE bảo vệ
        await tx.$executeRawUnsafe(
          `INSERT INTO doctor_slot_bookings
             (doctor_id, slot_date, slot_window, contract_id, encounter_id, visit_type, status)
           SELECT e.doctor_id, $2::date, $3, e.contract_id, e.id,
                  CASE WHEN e.encounter_type = 'TELEHEALTH' THEN 'VIDEO' ELSE 'HOME_VISIT' END,
                  'BOOKED'
           FROM encounters e WHERE e.id = $1::uuid`,
          encounterId,
          target.date,
          target.slotWindow,
        );
      }
      await tx.$executeRawUnsafe('RELEASE SAVEPOINT slot_ledger_move');
    } catch (error) {
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT slot_ledger_move');
      mapUniqueViolation(error, target);
    }
  }

  async releaseEncounter(tx: Tx, encounterId: string): Promise<void> {
    await tx.$executeRawUnsafe(
      `DELETE FROM doctor_slot_bookings WHERE encounter_id = $1::uuid`,
      encounterId,
    );
  }

  async releaseContractHolds(tx: Tx, contractId: string): Promise<void> {
    await tx.$executeRawUnsafe(
      `DELETE FROM doctor_slot_bookings WHERE contract_id = $1::uuid AND status = 'HELD'`,
      contractId,
    );
  }

  private async insertRow(
    tx: Tx,
    row: {
      doctorId: string;
      contractId: string;
      slot: SlotRequest;
      status: 'HELD' | 'BOOKED';
      expiresAt: Date | null;
      encounterId: string | null;
    },
  ): Promise<void> {
    // SAVEPOINT để lỗi UNIQUE không làm hỏng toàn bộ transaction của caller.
    await tx.$executeRawUnsafe('SAVEPOINT slot_ledger_insert');
    try {
      await tx.$executeRawUnsafe(
        `INSERT INTO doctor_slot_bookings
           (doctor_id, slot_date, slot_window, contract_id, encounter_id, visit_type, status, hold_expires_at)
         VALUES ($1::uuid, $2::date, $3, $4::uuid, $5::uuid, $6, $7, $8::timestamptz)`,
        row.doctorId,
        row.slot.date,
        row.slot.slotWindow,
        row.contractId,
        row.encounterId,
        row.slot.visitType,
        row.status,
        row.expiresAt,
      );
      await tx.$executeRawUnsafe('RELEASE SAVEPOINT slot_ledger_insert');
    } catch (error) {
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT slot_ledger_insert');
      mapUniqueViolation(error, row.slot);
    }
  }
}
