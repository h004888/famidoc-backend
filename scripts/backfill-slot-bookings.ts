import { PrismaClient } from '@prisma/client';
import {
  mapTimeToSlotWindow,
  type SlotWindow,
} from '../src/modules/encounters/utils/two-slot-schedule.util';

export type BackfillEncounterInput = {
  id: string;
  doctorId: string;
  contractId: string;
  encounterType: string;
  encounterStatus: string;
  scheduledDate: Date;
  scheduledTime: Date;
  slotWindow: string | null;
  createdAt: Date;
};

export type BackfillBookingRow = {
  doctorId: string;
  slotDate: string;
  slotWindow: SlotWindow;
  contractId: string;
  encounterId: string;
  visitType: 'HOME_VISIT' | 'VIDEO';
  status: 'BOOKED';
};

export type BackfillConflict = {
  encounterId: string;
  doctorId: string;
  contractId: string;
  slotDate: string;
  slotWindow: SlotWindow;
  reason: 'SLOT_CONFLICT' | 'CONTRACT_SAME_DAY';
};

const SKIP_STATUSES = new Set(['CANCELLED', 'COMPLETED', 'NO_SHOW']);

export function buildBackfillRows(
  encounters: BackfillEncounterInput[],
  todayIso: string = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10),
): {
  rows: BackfillBookingRow[];
  conflicts: BackfillConflict[];
  slotWindowUpdates: Array<{ id: string; slotWindow: SlotWindow }>;
} {
  const sorted = [...encounters].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );

  const seenDoctorSlot = new Set<string>();
  const seenContractDay = new Set<string>();
  const rows: BackfillBookingRow[] = [];
  const conflicts: BackfillConflict[] = [];
  const slotWindowUpdates: Array<{ id: string; slotWindow: SlotWindow }> = [];

  for (const enc of sorted) {
    if (SKIP_STATUSES.has(enc.encounterStatus)) continue;
    const slotDate = enc.scheduledDate.toISOString().slice(0, 10);
    if (slotDate < todayIso) continue;

    const slotWindow: SlotWindow =
      enc.slotWindow === 'MORNING' || enc.slotWindow === 'AFTERNOON'
        ? enc.slotWindow
        : mapTimeToSlotWindow(enc.scheduledTime);

    if (!enc.slotWindow) {
      slotWindowUpdates.push({ id: enc.id, slotWindow });
    }

    const doctorSlotKey = `${enc.doctorId}:${slotDate}:${slotWindow}`;
    if (seenDoctorSlot.has(doctorSlotKey)) {
      conflicts.push({
        encounterId: enc.id,
        doctorId: enc.doctorId,
        contractId: enc.contractId,
        slotDate,
        slotWindow,
        reason: 'SLOT_CONFLICT',
      });
      continue;
    }

    const contractDayKey = `${enc.contractId}:${slotDate}`;
    if (seenContractDay.has(contractDayKey)) {
      conflicts.push({
        encounterId: enc.id,
        doctorId: enc.doctorId,
        contractId: enc.contractId,
        slotDate,
        slotWindow,
        reason: 'CONTRACT_SAME_DAY',
      });
      continue;
    }

    seenDoctorSlot.add(doctorSlotKey);
    seenContractDay.add(contractDayKey);
    rows.push({
      doctorId: enc.doctorId,
      slotDate,
      slotWindow,
      contractId: enc.contractId,
      encounterId: enc.id,
      visitType: enc.encounterType === 'TELEHEALTH' ? 'VIDEO' : 'HOME_VISIT',
      status: 'BOOKED',
    });
  }

  return { rows, conflicts, slotWindowUpdates };
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const encounters = await prisma.encounter.findMany({
      where: {
        encounterStatus: { notIn: ['CANCELLED', 'COMPLETED', 'NO_SHOW'] },
      },
      select: {
        id: true,
        doctorId: true,
        contractId: true,
        encounterType: true,
        encounterStatus: true,
        scheduledDate: true,
        scheduledTime: true,
        slotWindow: true,
        createdAt: true,
      },
    });

    const { rows, conflicts, slotWindowUpdates } = buildBackfillRows(encounters);

    for (const upd of slotWindowUpdates) {
      await prisma.encounter.update({
        where: { id: upd.id },
        data: { slotWindow: upd.slotWindow },
      });
    }

    let inserted = 0;
    for (const row of rows) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO doctor_slot_bookings
           (doctor_id, slot_date, slot_window, contract_id, encounter_id, visit_type, status)
         VALUES ($1::uuid, $2::date, $3, $4::uuid, $5::uuid, $6, 'BOOKED')
         ON CONFLICT DO NOTHING`,
        row.doctorId,
        row.slotDate,
        row.slotWindow,
        row.contractId,
        row.encounterId,
        row.visitType,
      );
      inserted += 1;
    }

    console.log(
      JSON.stringify({
        slotWindowUpdated: slotWindowUpdates.length,
        inserted,
        conflictsCount: conflicts.length,
        conflicts,
      }, null, 2),
    );
  } finally {
    await prisma.$disconnect();
  }
}

const isMain =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  (process.argv[1]?.endsWith('backfill-slot-bookings.ts') ||
    process.argv[1]?.endsWith('backfill-slot-bookings.js'));

if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
