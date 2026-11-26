import type { Prisma } from '@prisma/client';

const DEFAULT_CONTRACT_HOLD_TTL_HOURS = 24;
export const DEFAULT_MAX_PANEL_CAPACITY = 5;
export const DEFAULT_RENEWAL_GRACE_DAYS = 7;

/**
 * Chuẩn hóa số ngày ân hạn gia hạn hợp đồng: luôn ép tối thiểu 7 ngày (R3).
 */
export function clampRenewalGraceDays(raw: unknown): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_RENEWAL_GRACE_DAYS;
  }
  return Math.max(DEFAULT_RENEWAL_GRACE_DAYS, Math.floor(parsed));
}
export function computeMonthlyHomeVisitDemand(
  periodicVisitsQuota: number | null | undefined,
  durationMonths: number | null | undefined,
): number {
  const visits = Math.max(0, Number(periodicVisitsQuota ?? 0));
  if (visits === 0) return 0;
  const months = Math.max(1, Number(durationMonths ?? 1));
  return Math.ceil(visits / months);
}

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
  const notSequentialRenewalOfActiveSource = {
    OR: [
      { upgradedFromId: null },
      { upgradedFrom: { contractStatus: { not: 'ACTIVE' as const } } },
    ],
  };
  return {
    ...(doctorId ? { doctorId } : {}),
    ...(options?.exceptContractId
      ? { id: { not: options.exceptContractId } }
      : {}),
    OR: [
      { contractStatus: 'ACTIVE' },
      {
        contractStatus: 'PENDING_ACTIVATION',
        ...notSequentialRenewalOfActiveSource,
      },
      { contractStatus: 'PENDING_APPROVAL', signingDeadlineAt: { not: null } },
      {
        contractStatus: { in: ['PENDING_APPROVAL', 'PENDING_PAYMENT'] },
        AND: [
          { OR: [{ holdExpiresAt: null }, { holdExpiresAt: { gt: now } }] },
          notSequentialRenewalOfActiveSource,
        ],
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

export interface DoctorPanelLoad {
  activeAndHeldCount: number;
}

/**
 * Đếm hàng loạt số hợp đồng ACTIVE + giữ chỗ PENDING_* còn hạn
 * kèm tổng quỹ khung Khám tại nhà/tháng đang chiếm dụng theo danh sách doctorId.
 */
export async function countActiveAndHeldLoadMap(
  prisma: {
    medicalContract: {
      findMany: (args: {
        where: Prisma.MedicalContractWhereInput;
        select: {
          doctorId: true;
          servicePackage?: { select: { periodicVisitsQuota: true; durationMonths: true } };
        };
      }) => Promise<
        Array<{
          doctorId: string | null;
          servicePackage?: { periodicVisitsQuota?: number | null; durationMonths?: number | null } | null;
        }>
      >;
    };
  },
  doctorIds: string[],
  now = new Date(),
): Promise<Map<string, DoctorPanelLoad>> {
  const loads = new Map<string, DoctorPanelLoad>();
  if (doctorIds.length === 0) return loads;

  const rows = await prisma.medicalContract.findMany({
    where: {
      doctorId: { in: doctorIds },
      ...buildActiveAndHeldWhere(undefined, { now }),
    },
    select: {
      doctorId: true,
      servicePackage: {
        select: { periodicVisitsQuota: true, durationMonths: true },
      },
    },
  });

  for (const row of rows) {
    if (!row.doctorId) continue;
    const prev = loads.get(row.doctorId) ?? { activeAndHeldCount: 0 };
    prev.activeAndHeldCount += 1;
    loads.set(row.doctorId, prev);
  }
  return loads;
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
