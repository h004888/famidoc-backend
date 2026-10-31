import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  notifyContractParties,
  todayInVietnam,
} from '../../../core/business/business-helpers';
import { moneyToNumber } from '../../../core/database/prisma-transaction';
// Dùng chung cho phụ lục đã trả tiền và phụ lục thêm người miễn phí trong hạn mức có sẵn.
export async function activateAddendumRights(
  tx: Prisma.TransactionClient,
  contractId: string,
  addendumId: string,
) {
  await tx.$queryRaw`SELECT id FROM medical_contracts WHERE id=${contractId}::uuid FOR UPDATE`;
  const parent = await tx.medicalContract.findUniqueOrThrow({
    where: { id: contractId },
    include: {
      familyUnit: true,
      doctor: true,
      facility: true,
    },
  });
  const item = await tx.contractAddendum.findUniqueOrThrow({
    where: { id: addendumId },
    include: {
      signatures: {
        include: { signerUser: { select: { role: true, status: true } } },
      },
      invoices: true,
    },
  });
  if (item.contractId !== contractId)
    throw new ConflictException('Addendum belongs to a different contract');
  if (item.status === 'ACTIVE') return item;
  if (
    item.status !== 'PENDING_PAYMENT' ||
    parent.contractStatus !== 'ACTIVE' ||
    parent.startDate > todayInVietnam() ||
    parent.endDate <= todayInVietnam()
  )
    throw new ConflictException('The contract is not currently serving');
  if (
    parent.doctor.onboardingStatus !== 'ACTIVE' ||
    parent.doctor.facilityId !== parent.facilityId ||
    parent.facility.verificationStatus !== 'ACTIVE' ||
    parent.familyUnit.status !== 'ACTIVE'
  )
    throw new ConflictException(
      'The doctor, facility or family is not eligible for new service rights',
    );
  const parties = {
    FAMILY_REP: parent.familyUnit.representativeUserId,
    HEALTHCARE_FACILITY: parent.facility.userId,
    ASSIGNED_DOCTOR: parent.doctor.userId,
  };
  const roles = [
    'FAMILY_REP',
    'ADMIN',
    'HEALTHCARE_FACILITY',
    'ASSIGNED_DOCTOR',
  ] as const;
  if (
    roles.some(
      (role) =>
        !item.signatures.some(
          (s) =>
            s.signerRole === role &&
            s.termsHash === item.termsHash &&
            s.signerUser.status === 'ACTIVE' &&
            (role === 'ADMIN'
              ? s.signerUser.role === 'ADMIN'
              : s.signerUserId === parties[role]),
        ),
    )
  )
    throw new ConflictException(
      'The addendum is missing a required confirmation',
    );
  if (
    moneyToNumber(item.additionalAmount) > 0 &&
    !item.invoices.some(
      (i) =>
        i.paymentStatus === 'PAID' &&
        i.acceptedTransactionId &&
        moneyToNumber(i.totalPayable) === moneyToNumber(item.additionalAmount),
    )
  )
    throw new ConflictException('The payable addendum has not been paid');
  const details = item.termsSnapshot as {
    additionalMembers?: number;
    previousMemberCount?: number;
    newMemberCount?: number;
    memberIds?: string[]; // Chỉ để xử lý phụ lục cũ được lập trước khi đổi sang mua theo số lượng.
    familyId?: string;
    facilityId?: string;
    doctorId?: string;
  };
  if (
    details.familyId !== parent.familyId ||
    details.facilityId !== parent.facilityId ||
    details.doctorId !== parent.doctorId
  )
    throw new ConflictException(
      'Contract parties changed after the addendum was drafted',
    );
  let memberCount = parent.memberCount;
  if (item.addendumType === 'MEMBER_EXTENSION') {
    const terms = parent.billingSnapshot as { members?: { maxCount?: number } };
    const added = details.additionalMembers ?? details.memberIds?.length ?? 0;
    const expectedCount = details.previousMemberCount ?? parent.memberCount;
    const newCount = parent.memberCount + added;
    const familyCount = await tx.patient.count({
      where: { familyId: parent.familyId, status: 'ACTIVE' },
    });
    if (
      !Number.isSafeInteger(added) ||
      added < 1 ||
      expectedCount !== parent.memberCount ||
      newCount > Math.min(6, terms.members?.maxCount ?? 6) ||
      newCount < familyCount ||
      (details.newMemberCount !== undefined &&
        details.newMemberCount !== newCount)
    )
      throw new ConflictException(
        'Family size or purchased member count changed before activation',
      );
    // Chỉ tăng số người đã mua sau khi phụ lục đủ xác nhận và đã trả phụ phí (nếu có).
    memberCount = newCount;
  } else if (item.addendumType !== 'QUOTA_EXPANSION')
    throw new ConflictException('Renewal must create a new contract');
  // Chỉ cộng quyền lợi đúng một lần; trạng thái ACTIVE và quota cùng commit với nhau.
  await tx.medicalContract.update({
    where: { id: contractId },
    data: {
      memberCount,
      remainingHomeVisits: { increment: item.extraHomeVisits },
      remainingTelehealth: { increment: item.extraTelehealth },
    },
  });
  const updated = await tx.contractAddendum.update({
    where: { id: item.id },
    data: { status: 'ACTIVE', activatedAt: new Date() },
  });
  await notifyContractParties(
    tx,
    parent,
    'Phụ lục đã có hiệu lực',
    'Phụ lục đã đủ xác nhận và nghĩa vụ thanh toán, quyền lợi đã được cập nhật.',
    'ADDENDUM_ACTIVE',
  );
  await tx.auditLog.create({
    data: {
      action: 'ACTIVATE_CONTRACT_ADDENDUM',
      resourceName: 'contract_addenda',
      resourceId: item.id,
      clientIp: 'system',
    },
  });
  return updated;
}
