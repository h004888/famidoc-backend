import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

export const SIGNING_EXPIRED_REASON = 'Hết hạn ký hợp đồng sau 24 giờ';
const NOTICE_ROLES = [
  'HEALTHCARE_FACILITY',
  'ASSIGNED_DOCTOR',
  'ADMIN',
] as const;

export function assertSigningDeadline(
  deadline?: Date | null,
  now = new Date(),
) {
  if (deadline && now >= deadline) {
    throw new ConflictException(SIGNING_EXPIRED_REASON);
  }
}

export async function queueSigningNotices(
  tx: Prisma.TransactionClient,
  contractId: string,
  deadline: Date,
  now = new Date(),
) {
  if (now >= deadline) return;
  const reminderAt = new Date(deadline.getTime() - 3_600_000);
  await tx.contractSigningNotice.createMany({
    data: NOTICE_ROLES.flatMap((role) =>
      now >= reminderAt
        ? [{ contractId, role, kind: 'URGENT', nextAttemptAt: now }]
        : [
            { contractId, role, kind: 'OPEN', nextAttemptAt: now },
            { contractId, role, kind: 'REMINDER', nextAttemptAt: reminderAt },
          ],
    ),
    skipDuplicates: true,
  });
}
