import type { Prisma } from '@prisma/client';

const DEFAULT_CONTRACT_HOLD_TTL_HOURS = 24;
const DEFAULT_MAX_PANEL_CAPACITY = 5;

export function resolveContractHoldTtlHours(): number {
  const raw = Number(process.env.CONTRACT_HOLD_TTL_HOURS);
  if (!Number.isFinite(raw) || raw <= 0) {
    return DEFAULT_CONTRACT_HOLD_TTL_HOURS;
  }
  return raw;
}

export function computeContractHoldExpiresAt(now = new Date()): Date {
  const ttlHours = resolveContractHoldTtlHours();
  return new Date(now.getTime() + ttlHours * 3_600_000);
}

/**
 * Điều kiện đếm slot đang chiếm dụng của bác sĩ:
 * - Hợp đồng ACTIVE
 * - Hoặc bản nháp PENDING_APPROVAL / PENDING_PAYMENT chưa quá hạn giữ chỗ (holdExpiresAt IS NULL OR holdExpiresAt > now)
 */
export function buildActiveAndHeldWhere(
  doctorId?: string,
  options?: { now?: Date; exceptContractId?: string },
): Prisma.MedicalContractWhereInput {
  const now = options?.now ?? new Date();
  return {
    ...(doctorId ? { doctorId } : {}),
    ...(options?.exceptContractId
      ? { id: { not: options.exceptContractId } }
      : {}),
    OR: [
      { contractStatus: 'ACTIVE' },
      { contractStatus: 'PENDING_APPROVAL', signingDeadlineAt: { not: null } },
      {
        contractStatus: { in: ['PENDING_APPROVAL', 'PENDING_PAYMENT'] },
        OR: [{ holdExpiresAt: null }, { holdExpiresAt: { gt: now } }],
      },
    ],
  };
}

export function computeQuotaMetrics(
  maxPanelCapacity: number | null | undefined,
  activeAndHeldCount: number,
): {
  maxCapacity: number;
  activeAndHeldCount: number;
  remainingSlots: number;
  isQuotaFull: boolean;
} {
  const maxCapacity =
    typeof maxPanelCapacity === 'number' && maxPanelCapacity > 0
      ? maxPanelCapacity
      : DEFAULT_MAX_PANEL_CAPACITY;
  const safeCount = Math.max(0, activeAndHeldCount);
  const remainingSlots = Math.max(0, maxCapacity - safeCount);
  return {
    maxCapacity,
    activeAndHeldCount: safeCount,
    remainingSlots,
    isQuotaFull: remainingSlots === 0,
  };
}

/**
 * Đếm hàng loạt số hợp đồng ACTIVE + giữ chỗ PENDING_* còn hạn theo danh sách doctorId.
 */
export async function countActiveAndHeldMap(
  prisma: {
    medicalContract: {
      findMany: (args: {
        where: Prisma.MedicalContractWhereInput;
        select: { doctorId: true };
      }) => Promise<Array<{ doctorId: string | null }>>;
    };
  },
  doctorIds: string[],
  now = new Date(),
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (doctorIds.length === 0) return counts;

  const rows = await prisma.medicalContract.findMany({
    where: {
      doctorId: { in: doctorIds },
      ...buildActiveAndHeldWhere(undefined, { now }),
    },
    select: { doctorId: true },
  });

  for (const row of rows) {
    if (!row.doctorId) continue;
    counts.set(row.doctorId, (counts.get(row.doctorId) ?? 0) + 1);
  }
  return counts;
}
