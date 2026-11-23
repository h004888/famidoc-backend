import type { FacilitySettlement } from '@prisma/client';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../../core/auth/authenticated-request';
import type { StorageService } from '../../../core/services/storage.service';
import type { SePayReconciliationConfig } from '../../payments/sepay/sepay-reconciliation.config';
import type { FinanceSession, IFinanceRepository } from '../repositories/interfaces/finance.repository.interface';
import { FinanceServiceImpl } from '../services/impl/finance.service.impl';

const admin: AuthenticatedUser = { id: 'admin', role: 'ADMIN', familyUnitId: null };
const facility: AuthenticatedUser = { id: 'facility-user', role: 'HEALTHCARE_FACILITY', familyUnitId: null };
const statementId = '10000000-0000-4000-8000-000000000099';
const reason = 'Số tiền trên bảng chưa khớp với hóa đơn.';

describe('Facility settlement review and transfer evidence', () => {
  let service: FinanceServiceImpl;
  let current: FacilitySettlement;
  const updateSettlement = jest.fn();
  const createSettlement = jest.fn();
  const createSettlementItems = jest.fn();
  const findEligibleInvoices = jest.fn();
  const findPeriodSettlement = jest.fn();
  const findSettlements = jest.fn();
  const getSatisfactionSummary = jest.fn();
  const recordFinanceEvent = jest.fn();
  const objectExists = jest.fn();
  const uploadFile = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    current = {
      id: statementId, settlementCode: 'ST-01', facilityId: 'own-facility', environment: 'LIVE',
      year: 2026, month: 10, disbursementStatus: 'PENDING', reviewStatus: 'PENDING',
      reviewVersion: 1, reviewDisputeReason: null, reviewedAt: null,
      totalRealizedRevenue: new Prisma.Decimal(1000000),
      platformFeeAmount: new Prisma.Decimal(150000), facilityPayoutAmount: new Prisma.Decimal(850000),
      bankTransferOrderId: null, transferMemo: null, settledAt: null, createdAt: new Date('2026-11-05T01:00:00Z'),
      bankDestination: {}, failureReason: null, transferEvidenceKey: null, confirmedByUserId: null,
    };
    updateSettlement.mockImplementation(async (_id: string, data: Prisma.FacilitySettlementUncheckedUpdateInput) => {
      const { reviewVersion, ...other } = data;
      current = {
        ...current,
        ...other,
        reviewVersion: typeof reviewVersion === 'object'
          ? current.reviewVersion + (reviewVersion.increment ?? 0)
          : reviewVersion ?? current.reviewVersion,
      } as FacilitySettlement;
      return current;
    });
    const session = {
      findFacilityForUser: async (userId: string) => ({ id: userId === facility.id ? 'own-facility' : 'other-facility' }),
      findSettlement: async (id: string) => id === current.id ? current : null,
      findEligibleInvoices,
      findPeriodSettlement,
      createSettlement,
      createSettlementItems,
      findSettlements,
      getSatisfactionSummary,
      updateSettlement,
      recordFinanceEvent,
    } as unknown as FinanceSession;
    const repository: IFinanceRepository = { transaction: (work) => work(session) };
    service = new FinanceServiceImpl(
      repository,
      { objectExists, uploadFile } as unknown as StorageService,
      { isEnabled: () => false } as SePayReconciliationConfig,
    );
  });

  it('restricts review to the owner, records a dispute once and rejects an outdated review after reopening', async () => {
    const dispute = { action: 'REPORT_DISCREPANCY', environment: 'LIVE', reviewVersion: 1, reason } as const;
    await expect(service.reviewSettlement({ ...facility, id: 'other-user' }, statementId, dispute))
      .rejects.toMatchObject({ status: 404 });
    await expect(service.reviewSettlement(facility, statementId, dispute))
      .resolves.toMatchObject({ reviewStatus: 'DISPUTED', reviewDisputeReason: reason });
    await service.reviewSettlement(facility, statementId, dispute);
    expect(recordFinanceEvent).toHaveBeenCalledTimes(1);

    await expect(service.executeMonthlySettlement(admin, {
      action: 'REOPEN_REVIEW', settlementId: statementId, environment: 'LIVE', reviewVersion: 1,
    })).resolves.toMatchObject({ reviewStatus: 'PENDING', reviewVersion: 2, reviewDisputeReason: reason });
    await expect(service.reviewSettlement(facility, statementId, {
      action: 'CONFIRM', environment: 'LIVE', reviewVersion: 1,
    })).rejects.toMatchObject({ status: 409 });
    await expect(service.reviewSettlement(facility, statementId, {
      action: 'CONFIRM', environment: 'LIVE', reviewVersion: 2,
    })).resolves.toMatchObject({ reviewStatus: 'CONFIRMED', disbursementStatus: 'PENDING' });
  });

  it('uploads genuine evidence for a confirmed statement and binds the object key to that statement', async () => {
    const pdf = {
      originalname: 'proof.exe', mimetype: 'application/pdf', buffer: Buffer.from('%PDF-1.7'),
    } as Express.Multer.File;
    await expect(service.uploadSettlementEvidence(admin, statementId, 'LIVE', pdf))
      .rejects.toMatchObject({ status: 409 });
    const confirmation = {
      action: 'CONFIRM_TRANSFER', environment: 'LIVE', settlementId: statementId, amountPaidVnd: 850000,
      paidAt: '2026-11-06T01:00:00Z', bankTransferOrderId: 'FT123',
      evidenceKey: `admin/settlements/${statementId}/proof.pdf`,
    } as const;
    await expect(service.executeMonthlySettlement(admin, confirmation)).rejects.toMatchObject({ status: 409 });
    expect(uploadFile).not.toHaveBeenCalled();
    expect(objectExists).not.toHaveBeenCalled();

    await service.reviewSettlement(facility, statementId, { action: 'CONFIRM', environment: 'LIVE', reviewVersion: 1 });
    await expect(service.uploadSettlementEvidence(facility, statementId, 'LIVE', pdf))
      .rejects.toMatchObject({ status: 403 });
    await expect(service.uploadSettlementEvidence(admin, statementId, 'LIVE', {
      ...pdf, buffer: Buffer.from('not a pdf'),
    })).rejects.toMatchObject({ status: 400 });
    uploadFile.mockResolvedValueOnce(confirmation.evidenceKey);
    await expect(service.uploadSettlementEvidence(admin, statementId, 'LIVE', pdf))
      .resolves.toEqual({ evidenceKey: confirmation.evidenceKey });
    expect(uploadFile).toHaveBeenCalledWith(
      { ...pdf, originalname: 'chung-tu.pdf' }, `admin/settlements/${statementId}`,
    );
    await expect(service.executeMonthlySettlement(admin, {
      ...confirmation, evidenceKey: 'admin/settlements/another-statement/proof.pdf',
    })).rejects.toMatchObject({ status: 400 });
    objectExists.mockResolvedValueOnce(true);
    await expect(service.executeMonthlySettlement(admin, confirmation))
      .resolves.toMatchObject({ disbursementStatus: 'SETTLED', transferEvidenceKey: confirmation.evidenceKey });
  });

  it('snapshots bankBin and bankCode into bankDestination when preparing a monthly settlement', async () => {
    findEligibleInvoices.mockResolvedValueOnce([
      {
        id: 'inv-1',
        totalPayable: new Prisma.Decimal(1000000),
        paidAt: new Date('2026-10-05T00:00:00Z'),
        addendumId: null,
        addendum: null,
        settlementItems: [],
        contract: {
          facilityId: 'own-facility',
          startDate: new Date('2026-10-01T00:00:00Z'),
          endDate: new Date('2026-10-31T00:00:00Z'),
          terminatedAt: null,
          facility: {
            id: 'own-facility',
            bankName: 'Vietcombank - Ngân hàng TMCP Ngoại thương Việt Nam',
            bankBin: '970436',
            bankCode: 'VCB',
            bankAccountNumber: '0011002233445',
            bankAccountHolder: 'BV AN SINH',
          },
        },
      },
    ]);
    findPeriodSettlement.mockResolvedValueOnce(null);
    createSettlement.mockImplementationOnce(async (data) => ({
      ...current,
      ...data,
    }));
    createSettlementItems.mockResolvedValueOnce(undefined);
    getSatisfactionSummary.mockResolvedValueOnce({
      reviewCount: 0,
      averageStars: null,
      affectsPayout: false,
      byDoctor: [],
    });
    findSettlements.mockResolvedValueOnce([]);

    const result = await service.executeMonthlySettlement(admin, {
      action: 'PREPARE',
      year: 2026,
      month: 10,
      environment: 'LIVE',
    });

    expect(result).toMatchObject({ year: 2026, month: 10, settlementFrequency: 'MONTHLY', transferExecuted: false });
    expect(findEligibleInvoices).toHaveBeenCalledWith(expect.objectContaining({
      start: new Date('2026-09-30T17:00:00Z'),
      end: new Date('2026-10-31T17:00:00Z'),
    }));
    expect(createSettlement).toHaveBeenCalledWith(
      expect.objectContaining({
        facilityId: 'own-facility',
        month: 10,
        year: 2026,
        bankDestination: {
          bankName: 'Vietcombank - Ngân hàng TMCP Ngoại thương Việt Nam',
          bankBin: '970436',
          bankCode: 'VCB',
          accountNumber: '0011002233445',
          accountHolder: 'BV AN SINH',
        },
      }),
    );
  });
});
