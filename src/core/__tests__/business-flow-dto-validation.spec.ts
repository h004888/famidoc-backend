import { ValidationPipe } from '@nestjs/common';
import { ResolveComplaintDto } from '../../modules/complaints/dtos/complaint.dto';
import {
  CreateContractAddendumDto,
  CreatePackageUpgradeDto,
  DecideTerminationDto,
  SignContractChangeDto,
  TerminateContractDto,
} from '../../modules/contracts/dtos/contract-change.dto';
import {
  MonthlySettlementDto,
  RevenueAnalyticsQueryDto,
} from '../../modules/finance/dtos/finance.dto';

const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
});
const id = '60000000-0000-4000-8000-000000000001';
const hash = 'a'.repeat(64);
const notes = 'Đã xác minh lịch khám của gia đình.';
const confirmTransfer = {
  action: 'CONFIRM_TRANSFER',
  settlementId: id,
  bankTransferOrderId: 'DEMO-TRANSFER',
  amountPaidVnd: 100,
  paidAt: '2026-11-10T15:00:00+07:00',
  evidenceKey: `${id}/settlements/proof.pdf`,
};

describe('Validation đầu vào BF5 và BF6', () => {
  it.each([
    [CreateContractAddendumDto, { requestKey: id, type: 'QUOTA_EXPANSION' }],
    [
      CreateContractAddendumDto,
      {
        requestKey: id,
        type: 'QUOTA_EXPANSION',
        extraHomeVisits: 1,
        additionalMembers: 0,
      },
    ],
    [
      CreateContractAddendumDto,
      {
        requestKey: id,
        type: 'MEMBER_EXTENSION',
        additionalMembers: 1,
        extraHomeVisits: null,
      },
    ],
    [CreatePackageUpgradeDto, { packageId: id, extraHomeVisits: 1 }],
    [
      TerminateContractDto,
      { action: 'REQUEST', reason: notes, termsHash: hash },
    ],
    [
      TerminateContractDto,
      { action: 'CONSENT', requestId: id, termsHash: 'z'.repeat(64) },
    ],
    [DecideTerminationDto, { action: 'REJECT', contractId: id }],
    [SignContractChangeDto, { acceptedTerms: true, termsHash: 'z'.repeat(64) }],
    [MonthlySettlementDto, { environment: null }],
    [MonthlySettlementDto, { year: 2026, month: true }],
    [MonthlySettlementDto, { action: 'PREPARE', settlementId: id }],
    [MonthlySettlementDto, { ...confirmTransfer, paidAt: '2026-11-10' }],
    [
      MonthlySettlementDto,
      { ...confirmTransfer, paidAt: '2026-11-10T15:00:00' },
    ],
    [MonthlySettlementDto, { ...confirmTransfer, facilityId: id }],
    [MonthlySettlementDto, { ...confirmTransfer, failureReason: notes }],
    [ResolveComplaintDto, { action: 'CLOSE', outcome: 'WARNING' }],
    [ResolveComplaintDto, { action: 'RESOLVE', notes }],
    [ResolveComplaintDto, { action: 'FACILITY_RESPONSE' }],
  ] as const)('trả 400 cho %p với dữ liệu sai %p', async (metatype, body) => {
    await expect(
      pipe.transform(body, { type: 'body', metatype }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it.each([
    [
      CreateContractAddendumDto,
      { requestKey: id, type: 'QUOTA_EXPANSION', extraHomeVisits: 1 },
    ],
    [
      CreateContractAddendumDto,
      { requestKey: id, type: 'MEMBER_EXTENSION', additionalMembers: 1 },
    ],
    [CreatePackageUpgradeDto, { packageId: id, videoConsultations: 24 }],
    [TerminateContractDto, { reason: notes }],
    [
      TerminateContractDto,
      { action: 'APPROVE', requestId: id, termsHash: hash },
    ],
    [SignContractChangeDto, { acceptedTerms: true, termsHash: hash }],
    [MonthlySettlementDto, { facilityId: id }],
    [MonthlySettlementDto, confirmTransfer],
    [
      MonthlySettlementDto,
      { action: 'MARK_FAILED', settlementId: id, failureReason: notes },
    ],
    [ResolveComplaintDto, { action: 'INVESTIGATE' }],
    [ResolveComplaintDto, { action: 'CLOSE', notes }],
    [ResolveComplaintDto, { action: 'FACILITY_RESPONSE', notes }],
    [ResolveComplaintDto, { action: 'RESOLVE', notes, outcome: 'WARNING' }],
  ] as const)('nhận dữ liệu hợp lệ cho %p với %p', async (metatype, body) => {
    await expect(
      pipe.transform(body, { type: 'body', metatype }),
    ).resolves.toMatchObject(body);
  });

  it('giữ bộ lọc query của báo cáo và giá trị mặc định', async () => {
    await expect(
      pipe.transform(
        { year: '2026', month: '10', facilityId: id },
        {
          type: 'query',
          metatype: RevenueAnalyticsQueryDto,
        },
      ),
    ).resolves.toMatchObject({
      year: 2026,
      month: 10,
      facilityId: id,
      environment: 'LIVE',
    });
  });
});
