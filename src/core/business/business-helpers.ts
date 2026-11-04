import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import type { AuthenticatedUser } from '../auth/authenticated-request';

export interface ContractParties {
  id: string;
  familyId: string;
  doctor: { userId: string };
  facility: { userId: string };
  familyUnit: { representativeUserId: string };
}
export function getContractSignerRole(
  contract: ContractParties,
  actor: AuthenticatedUser,
) {
  if (actor.role === 'ADMIN') return 'ADMIN' as const;
  if (
    actor.role === 'FAMILY_REP' &&
    contract.familyUnit.representativeUserId === actor.id
  )
    return 'FAMILY_REP' as const;
  if (
    actor.role === 'HEALTHCARE_FACILITY' &&
    contract.facility.userId === actor.id
  )
    return 'HEALTHCARE_FACILITY' as const;
  if (actor.role === 'DOCTOR' && contract.doctor.userId === actor.id)
    return 'ASSIGNED_DOCTOR' as const;
  throw new ForbiddenException('You are not a party to this contract');
}
export function createTermsHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
export function todayInVietnam(now = new Date()): Date {
  const date = new Date(now.getTime() + 7 * 3600000);
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}
export function getVietnamMonthWindow(year: number, month: number) {
  return {
    start: new Date(Date.UTC(year, month - 1, 1) - 7 * 3600000),
    end: new Date(Date.UTC(year, month, 1) - 7 * 3600000),
  };
}
export async function writeBusinessAudit(
  tx: Prisma.TransactionClient,
  actorId: string,
  action: string,
  resourceName: string,
  resourceId: string,
) {
  await tx.auditLog.create({
    data: {
      actorUserId: actorId,
      action,
      resourceName,
      resourceId,
      clientIp: 'unknown',
    },
  });
}
export async function notifyContractParties(
  tx: Prisma.TransactionClient,
  contract: ContractParties,
  title: string,
  content: string,
  type: string,
) {
  const users = new Set([
    contract.familyUnit.representativeUserId,
    contract.facility.userId,
    contract.doctor.userId,
  ]);
  // Chỉ thông báo trạng thái nghiệp vụ; không đưa chẩn đoán/bệnh án vào thông báo chung.
  await tx.notification.createMany({
    data: [...users].map((userId) => ({
      userId,
      title,
      content,
      type,
      referenceId: contract.id,
    })),
  });
}
