import { createTermsHash } from '../../../core/business/business-helpers';
interface SignableContract {
  id: string;
  contractNumber: string;
  familyId: string;
  facilityId: string;
  doctorId: string;
  billingSnapshot: unknown;
  startDate: Date;
  endDate: Date;
  legacyMemberIds?: unknown;
}
export function calculateContractTermsHash(contract: SignableContract) {
  // Xác nhận phải gắn cả người phụ trách và CSYT. Đổi phân công thì bản xác nhận cũ không còn khớp.
  const terms = contract.billingSnapshot as {
    members?: { requestedCount?: number };
  };
  return createTermsHash({
    id: contract.id,
    number: contract.contractNumber,
    familyId: contract.familyId,
    facilityId: contract.facilityId,
    doctorId: contract.doctorId,
    terms: contract.billingSnapshot,
    start: contract.startDate.toISOString(),
    end: contract.endDate.toISOString(),
    // Bản ký cũ dùng danh sách ID, giữ cách tính cũ để không làm hỏng xác nhận đã lưu.
    // Hợp đồng mới chỉ chốt số người ban đầu. Phụ lục được ký riêng, không đổi hash hợp đồng gốc.
    ...(Array.isArray(contract.legacyMemberIds)
      ? {
          members: [...contract.legacyMemberIds].sort((a, b) =>
            String(a).localeCompare(String(b)),
          ),
        }
      : { memberCount: terms?.members?.requestedCount }),
  });
}
