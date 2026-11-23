import { calculateMonthlyInvoiceShares } from '../../pricing/monthly-recognition';
import { calculateRevenueShares } from '../../pricing/revenue-sharing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AuthenticatedUser } from '../../../../core/auth/authenticated-request';
import { getVietnamMonthWindow } from '../../../../core/business/business-helpers';
import { moneyToNumber } from '../../../../core/database/prisma-transaction';
import { StorageService } from '../../../../core/services/storage.service';
import type {
  FacilityBusinessSummary,
  FacilityFamilyPackageItem,
  PackageSalesTotals,
  ParticipatingDoctorSummary,
} from '../../entities/finance.entity';
import {
  FINANCE_REPOSITORY_TOKEN,
  type FacilityBusinessInputs,
  type IFinanceRepository,
  type RevenueFilter,
  type RevenueInvoice,
} from '../../repositories/interfaces/finance.repository.interface';
import type { IFinanceService } from '../interfaces/finance.service.interface';
import type {
  MonthlySettlementDto,
  ReviewSettlementDto,
  RevenueAnalyticsQueryDto,
} from '../../dtos/finance.dto';
import { SePayReconciliationConfig } from '../../../payments/sepay/sepay-reconciliation.config';

function evidenceExtension(file?: Express.Multer.File) {
  const buffer = file?.buffer;
  if (file?.mimetype === 'application/pdf' && buffer?.subarray(0, 5).toString() === '%PDF-')
    return 'pdf';
  if (file?.mimetype === 'image/png' && buffer?.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')))
    return 'png';
  if (file?.mimetype === 'image/jpeg' && buffer?.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex')))
    return 'jpg';
  throw new BadRequestException('Chọn chứng từ PDF, PNG hoặc JPEG hợp lệ.');
}

function summarizeFacilityBusiness(
  {
    doctors,
    activeContracts,
    paidInvoices,
    packageInvoices,
  }: FacilityBusinessInputs,
  filter?: Pick<RevenueFilter, 'start' | 'end'>,
): FacilityBusinessSummary {
  const activeHouseholds = new Set<string>();
  const householdsByDoctor = new Map(doctors.map((doctor) => [doctor.id, new Set<string>()]));
  for (const { doctorId, familyId } of activeContracts) {
    activeHouseholds.add(familyId);
    if (doctorId) householdsByDoctor.get(doctorId)?.add(familyId);
  }

  const purchasingHouseholds = new Set<string>();
  const totals: PackageSalesTotals = {
    packagesSold: 0,
    grossVnd: 0,
    platformFeeVnd: 0,
    facilityShareVnd: 0,
  };
  const byPackage = new Map<string, FacilityBusinessSummary['purchases']['byPackage'][number]>();
  for (const invoice of paidInvoices) {
    if (!invoice.contract) continue;
    const { familyId, servicePackage } = invoice.contract;
    const packageCode = servicePackage.lineageCode;
    // Gộp các phiên bản của cùng gói. Số tiền luôn lấy từ hóa đơn đã thanh toán.
    const row = byPackage.get(packageCode) ?? {
      ...totals,
      packageCode,
      packageName: servicePackage.packageName,
    };
    const shares = calculateRevenueShares(moneyToNumber(invoice.totalPayable), 0);
    row.packagesSold += 1;
    row.grossVnd += shares.grossVnd;
    row.platformFeeVnd += shares.platformFeeVnd;
    row.facilityShareVnd += shares.facilityShareVnd;
    byPackage.set(packageCode, row);
    purchasingHouseholds.add(familyId);
  }
  for (const row of byPackage.values()) {
    totals.packagesSold += row.packagesSold;
    totals.grossVnd += row.grossVnd;
    totals.platformFeeVnd += row.platformFeeVnd;
    totals.facilityShareVnd += row.facilityShareVnd;
  }

  const familyPackages: FacilityFamilyPackageItem[] = [];
  const sourceInvoices = packageInvoices ?? paidInvoices;
  for (let index = 0; index < sourceInvoices.length; index += 1) {
    const invoice = sourceInvoices[index];
    const contract = invoice.contract;
    if (!contract) continue;

    const shares = calculateRevenueShares(moneyToNumber(invoice.totalPayable), 0);
    const doctorsMap = new Map<string, ParticipatingDoctorSummary>();
    if (contract.doctor) {
      doctorsMap.set(contract.doctor.id, {
        id: contract.doctor.id,
        doctorName: contract.doctor.doctorName,
        specialty: contract.doctor.specialty,
        isPrimary: true,
        encounterCount: 0,
      });
    }
    for (const encounter of contract.encounters ?? []) {
      const existing = doctorsMap.get(encounter.doctor.id);
      if (existing) {
        existing.encounterCount += 1;
      } else {
        doctorsMap.set(encounter.doctor.id, {
          id: encounter.doctor.id,
          doctorName: encounter.doctor.doctorName,
          specialty: encounter.doctor.specialty,
          isPrimary: false,
          encounterCount: 1,
        });
      }
    }
    const participatingDoctors = [...doctorsMap.values()].sort((a, b) => {
      if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
      if (a.encounterCount !== b.encounterCount) return b.encounterCount - a.encounterCount;
      return a.doctorName.localeCompare(b.doctorName, 'vi');
    });

    const purchasedInPeriod =
      filter && invoice.paidAt
        ? invoice.paidAt >= filter.start && invoice.paidAt < filter.end
        : true;

    const monthly =
      filter && invoice.paidAt && contract.startDate && contract.endDate
        ? calculateMonthlyInvoiceShares(
            {
              totalPayable: invoice.totalPayable,
              paidAt: invoice.paidAt,
              addendumId: invoice.addendumId ?? null,
              settlementItems: invoice.settlementItems,
              contract: {
                startDate: contract.startDate,
                endDate: contract.endDate,
                terminatedAt: contract.terminatedAt ?? null,
              },
            },
            filter,
          )
        : null;

    familyPackages.push({
      invoiceId: invoice.id ?? `${contract.familyId}-${contract.servicePackage.lineageCode}-${index}`,
      invoiceCode: invoice.invoiceCode ?? '',
      contractId: contract.id ?? '',
      contractNumber: contract.contractNumber ?? '',
      contractStatus: contract.contractStatus ?? 'ACTIVE',
      familyId: contract.familyId,
      familyName: contract.familyUnit?.representativeUser?.fullName ?? 'Hộ gia đình',
      memberCount: contract.memberCount ?? 1,
      packageCode: contract.servicePackage.lineageCode,
      packageName: contract.servicePackage.packageName,
      durationMonths: contract.servicePackage.durationMonths ?? 1,
      paidAt: invoice.paidAt ? invoice.paidAt.toISOString() : null,
      startDate: contract.startDate ? contract.startDate.toISOString() : null,
      endDate: contract.endDate ? contract.endDate.toISOString() : null,
      purchasedInPeriod,
      primaryDoctor: contract.doctor ?? null,
      participatingDoctors,
      packagePriceVnd: shares.grossVnd,
      platformFeePercent: 15,
      platformFeeVnd: shares.platformFeeVnd,
      facilitySharePercent: 85,
      facilityShareVnd: shares.facilityShareVnd,
      ...(monthly
        ? {
            periodRecognition: {
              grossVnd: monthly.grossVnd,
              platformFeeVnd: monthly.platformFeeVnd,
              facilityShareVnd: monthly.facilityShareVnd,
              serviceFrom: monthly.serviceFrom.toISOString(),
              serviceUntil: monthly.serviceUntil.toISOString(),
            },
          }
        : {}),
    });
  }

  return {
    activeHouseholds: activeHouseholds.size,
    doctors: doctors.map((doctor) => ({
      ...doctor,
      households: householdsByDoctor.get(doctor.id)?.size ?? 0,
    })),
    familyPackages,
    purchases: {
      ...totals,
      purchasingHouseholds: purchasingHouseholds.size,
      byPackage: [...byPackage.values()],
    },
  };
}

@Injectable()
export class FinanceServiceImpl implements IFinanceService {
  constructor(
    @Inject(FINANCE_REPOSITORY_TOKEN)
    private readonly repository: IFinanceRepository,
    private readonly storage: StorageService,
    private readonly sepayReconciliationConfig: SePayReconciliationConfig,
  ) {}
  getRevenueAnalytics(
    actor: AuthenticatedUser,
    query: RevenueAnalyticsQueryDto,
  ) {
    const period = this.resolveReportingPeriod(query);
    return this.repository.transaction(async (session) => {
      if (!['ADMIN', 'HEALTHCARE_FACILITY'].includes(actor.role))
        throw new ForbiddenException('Bạn không có quyền truy cập dữ liệu tài chính.');
      let facilityId = query.facilityId;
      if (actor.role === 'HEALTHCARE_FACILITY') {
        const facility = await session.findFacilityForUser(actor.id);
        if (!facility || (facilityId && facilityId !== facility.id))
          throw new NotFoundException('Không tìm thấy thông tin cơ sở y tế.');
        facilityId = facility.id;
      }
      const filter: RevenueFilter = {
        ...getVietnamMonthWindow(period.year, period.month),
        environment: query.environment,
        facilityId,
      };
      const invoices = await session.findEligibleInvoices(filter);
      const facilityBusiness =
        actor.role === 'HEALTHCARE_FACILITY' && facilityId
          ? summarizeFacilityBusiness(
              await session.getFacilityBusinessInputs({ ...filter, facilityId }),
              filter,
            )
          : undefined;
      const totals = {
        grossVnd: 0,
        vatVnd: 0,
        netVnd: 0,
        platformFeeVnd: 0,
        facilityShareVnd: 0,
      };
      for (const invoice of invoices) {
        const amount = this.getInvoiceShares(invoice, filter);
        for (const key of Object.keys(totals) as (keyof typeof totals)[])
          totals[key] += amount[key];
      }
      return {
        ...period,
        environment: query.environment,
        facilityId: facilityId ?? null,
        currency: 'VND' as const,
        invoiceCount: invoices.length,
        recognitionBasis: 'SERVICE_DAYS',
        settlementFrequency: 'MONTHLY' as const,
        platformFeeGrossVnd: totals.platformFeeVnd,
        platformFeeVatVnd: null,
        platformFeeNetVnd: null,
        taxTreatment:
          'Phí nền tảng 15% đã gồm thuế nếu phát sinh. Khoản 85% trả CSYT chưa khấu trừ hoặc nộp thay thuế thuộc nghĩa vụ của bên nhận. CSYT và bác sĩ tự xác định, kê khai và nộp thuế phát sinh theo hoạt động và quy định áp dụng. Dịch vụ khám bệnh, chữa bệnh thuộc đối tượng không chịu VAT theo quy định. Bảng chi trả chưa xác nhận bên nhận đã hoàn thành nghĩa vụ thuế.',
        satisfaction: await session.getSatisfactionSummary(filter),
        facilityBusiness,
        ...totals,
        // CSYT không xem nhật ký giao dịch chưa xác định của đơn vị khác.
        unmatchedTransactionsCount:
          actor.role === 'ADMIN'
            ? await session.countUnmatchedTransactions(filter)
            : undefined,
        unreconciledInvoiceCount:
          actor.role === 'ADMIN'
            ? invoices.filter(
                (invoice) => !invoice.acceptedTransaction?.reconciledAt,
              ).length
            : undefined,
        settlements: await session.findSettlements(
          filter,
          period.year,
          period.month,
        ),
      };
    });
  }

  reviewSettlement(actor: AuthenticatedUser, id: string, dto: ReviewSettlementDto) {
    if (actor.role !== 'HEALTHCARE_FACILITY')
      throw new ForbiddenException('Chỉ cơ sở y tế được xác nhận bảng đối soát của mình.');
    this.assertReportingEnvironment(dto.environment);
    return this.repository.transaction(async (session) => {
      const facility = await session.findFacilityForUser(actor.id);
      if (!facility) throw new NotFoundException('Không tìm thấy bảng quyết toán.');
      const item = await session.findSettlement(id);
      if (!item || item.facilityId !== facility.id || item.environment !== dto.environment)
        throw new NotFoundException('Không tìm thấy bảng quyết toán.');
      if (item.reviewVersion !== dto.reviewVersion)
        throw new ConflictException('Bảng quyết toán đã thay đổi. Hãy tải lại và kiểm tra số liệu mới.');

      const reviewStatus = dto.action === 'CONFIRM' ? 'CONFIRMED' : 'DISPUTED';
      if (item.reviewStatus === reviewStatus &&
          (reviewStatus === 'CONFIRMED' || item.reviewDisputeReason === dto.reason))
        return item;
      if (item.disbursementStatus === 'SETTLED' || item.reviewStatus !== 'PENDING')
        throw new ConflictException('Bảng quyết toán hiện không chờ CSYT xác nhận.');

      const updated = await session.updateSettlement(id, {
        reviewStatus,
        reviewedAt: new Date(),
        ...(reviewStatus === 'DISPUTED' ? { reviewDisputeReason: dto.reason } : {}),
      });
      await session.recordFinanceEvent(
        actor.id,
        updated,
        reviewStatus === 'CONFIRMED' ? 'FACILITY_CONFIRMED_SETTLEMENT' : 'FACILITY_DISPUTED_SETTLEMENT',
      );
      return updated;
    });
  }

  async uploadSettlementEvidence(
    actor: AuthenticatedUser,
    id: string,
    environment: MonthlySettlementDto['environment'],
    file?: Express.Multer.File,
  ) {
    if (actor.role !== 'ADMIN')
      throw new ForbiddenException('Chỉ Admin được tải chứng từ chi trả.');
    this.assertReportingEnvironment(environment);
    if (!file?.buffer?.length || file.buffer.length > 5 * 1024 * 1024)
      throw new BadRequestException('Chứng từ phải có dung lượng từ 1 byte đến 5 MB.');
    const extension = evidenceExtension(file);
    const item = await this.repository.transaction((session) => session.findSettlement(id));
    if (!item || item.environment !== environment)
      throw new NotFoundException('Không tìm thấy bảng quyết toán.');
    if (item.disbursementStatus === 'SETTLED' || item.reviewStatus !== 'CONFIRMED')
      throw new ConflictException('Chỉ tải chứng từ cho bảng đã được CSYT xác nhận và đang chờ ghi nhận chi trả.');

    try {
      const evidenceKey = await this.storage.uploadFile(
        { ...file, originalname: `chung-tu.${extension}` },
        `${actor.id}/settlements/${item.id}`,
      );
      return { evidenceKey };
    } catch {
      throw new ServiceUnavailableException('Không tải được chứng từ lên kho lưu trữ. Vui lòng thử lại.');
    }
  }

  executeMonthlySettlement(
    actor: AuthenticatedUser,
    dto: MonthlySettlementDto,
  ) {
    if (actor.role !== 'ADMIN')
      throw new ForbiddenException(
        'Chỉ Quản trị viên mới được lập bảng hoặc xác nhận chi trả quyết toán.',
      );
    const period = this.resolveReportingPeriod(dto);
    if (dto.action !== 'PREPARE') return this.updateSettlementStatus(actor, dto);
    const vnNow = new Date(Date.now() + 7 * 3600000);
    if (
      period.year * 12 + period.month >=
      vnNow.getUTCFullYear() * 12 + vnNow.getUTCMonth() + 1
    )
      throw new BadRequestException('Chỉ có thể lập bảng quyết toán cho các tháng đã kết thúc.');
    return this.repository.transaction(async (session) => {
      const filter: RevenueFilter = {
        ...getVietnamMonthWindow(period.year, period.month),
        environment: dto.environment,
        facilityId: dto.facilityId,
        onlyUnsettled: true,
      };
      const invoices = await session.findEligibleInvoices(filter);
      if (
        this.sepayReconciliationConfig.isEnabled() &&
        invoices.some((invoice) => !invoice.acceptedTransaction?.reconciledAt)
      )
        throw new ConflictException(
          'Vui lòng đồng bộ đối soát SePay trước khi lập bảng; còn hóa đơn đã thanh toán chưa được xác minh qua SePay API.',
        );
      const groups = new Map<string, RevenueInvoice[]>();
      for (const invoice of invoices) {
        if (!invoice.contract) continue;
        const key = invoice.contract.facilityId;
        groups.set(key, [...(groups.get(key) ?? []), invoice]);
      }
      for (const [facilityId, items] of groups) {
        let settlement = await session.findPeriodSettlement(
          facilityId,
          period.year,
          period.month,
          dto.environment,
        );
        if (settlement && settlement.disbursementStatus !== 'PENDING')
          throw new ConflictException(
            'Bảng quyết toán đã chi trả không thể thay đổi; các hóa đơn phát sinh muộn cần lập điều chỉnh riêng.',
          );
        const needsNewReview = Boolean(settlement);
        const facility = items[0].contract!.facility;
        if (!settlement)
          settlement = await session.createSettlement({
            settlementCode:
              'ST' + randomUUID().replaceAll('-', '').toUpperCase(),
            facilityId,
            ...period,
            environment: dto.environment,
            totalRealizedRevenue: 0,
            platformFeeAmount: 0,
            facilityPayoutAmount: 0,
            bankDestination: {
              bankName: facility.bankName,
              bankBin: facility.bankBin ?? null,
              bankCode: facility.bankCode ?? null,
              accountNumber: facility.bankAccountNumber,
              accountHolder: facility.bankAccountHolder,
            },
          });
        let revenue = 0,
          fee = 0,
          payout = 0;
        const lines = items.map((invoice) => {
          const shares = this.getInvoiceShares(invoice, filter);
          revenue += shares.netVnd;
          fee += shares.platformFeeVnd;
          payout += shares.facilityShareVnd;
          return {
            settlementId: settlement!.id,
            recognitionYear: period.year,
            recognitionMonth: period.month,
            recognitionBasis: 'SERVICE_DAYS',
            serviceFrom: shares.serviceFrom,
            serviceUntil: shares.serviceUntil,
            invoiceId: invoice.id,
            grossAmount: shares.grossVnd,
            vatAmount: shares.vatVnd,
            netAmount: shares.netVnd,
            platformFeeAmount: shares.platformFeeVnd,
            facilityShareAmount: shares.facilityShareVnd,
          };
        });
        // Unique invoice_id ngăn một hóa đơn bị đưa vào hai kỳ hoặc cộng lại khi API bị gọi trùng.
        await session.createSettlementItems(lines);
        settlement = await session.updateSettlement(settlement.id, {
          totalRealizedRevenue: { increment: revenue },
          platformFeeAmount: { increment: fee },
          facilityPayoutAmount: { increment: payout },
          ...(needsNewReview ? {
            reviewStatus: 'PENDING',
            reviewVersion: { increment: 1 },
            reviewedAt: null,
          } : {}),
        });
        await session.recordFinanceEvent(
          actor.id,
          settlement,
          'PREPARE_MONTHLY_SETTLEMENT',
        );
      }
      return {
        ...period,
        environment: dto.environment,
        transferExecuted: false as const,
        settlementFrequency: 'MONTHLY' as const,
        satisfaction: await session.getSatisfactionSummary(filter),
        message:
          'Đã lập bảng đối soát cho tháng đã chọn theo ngày phục vụ. Cần CSYT xác nhận trước khi ghi nhận chi trả hàng tháng.',
        settlements: await session.findSettlements(
          filter,
          period.year,
          period.month,
        ),
      };
    });
  }
  private updateSettlementStatus(
    actor: AuthenticatedUser,
    dto: MonthlySettlementDto,
  ) {
    return this.repository.transaction(async (session) => {
      const item = await session.findSettlement(dto.settlementId!);
      if (!item || item.environment !== dto.environment)
        throw new NotFoundException('Không tìm thấy bảng quyết toán.');
      if (
        (dto.year !== undefined && dto.year !== item.year) ||
        (dto.month !== undefined && dto.month !== item.month)
      )
        throw new BadRequestException(
          'Kỳ quyết toán không khớp với bảng đang chọn.',
        );
      if (item.disbursementStatus === 'SETTLED') {
        if (
          dto.action === 'CONFIRM_TRANSFER' &&
          item.bankTransferOrderId === dto.bankTransferOrderId &&
          moneyToNumber(item.facilityPayoutAmount) === dto.amountPaidVnd &&
          item.transferEvidenceKey === dto.evidenceKey &&
          (dto.transferMemo === undefined || item.transferMemo === dto.transferMemo) &&
          item.settledAt?.getTime() === Date.parse(dto.paidAt!)
        )
          return item;
        throw new ConflictException('Bảng quyết toán đã chi trả xong, không thể ghi đè.');
      }
      if (dto.reviewVersion !== undefined && dto.reviewVersion !== item.reviewVersion)
        throw new ConflictException('Bảng quyết toán đã thay đổi. Hãy tải lại trước khi tiếp tục.');
      if (dto.action === 'REOPEN_REVIEW') {
        if (item.reviewStatus !== 'DISPUTED')
          throw new ConflictException('Chỉ gửi lại bảng đang có báo cáo sai lệch.');
        const updated = await session.updateSettlement(item.id, {
          reviewStatus: 'PENDING',
          reviewVersion: { increment: 1 },
          reviewedAt: null,
        });
        await session.recordFinanceEvent(actor.id, updated, 'REOPEN_SETTLEMENT_REVIEW');
        return updated;
      }
      if (dto.action === 'MARK_FAILED') {
        const updated = await session.updateSettlement(item.id, {
          disbursementStatus: 'FAILED',
          failureReason: dto.failureReason,
        });
        await session.recordFinanceEvent(
          actor.id,
          updated,
          'MARK_SETTLEMENT_FAILED',
        );
        return updated;
      }
      if (item.reviewStatus !== 'CONFIRMED')
        throw new ConflictException('Cơ sở y tế cần xác nhận bảng đối soát trước khi ghi nhận chi trả.');
      if (dto.amountPaidVnd !== moneyToNumber(item.facilityPayoutAmount))
        throw new BadRequestException(
          'Số tiền đã chuyển không khớp với phần chi trả của cơ sở y tế.',
        );
      const prefix = `${actor.id}/settlements/`;
      const evidenceKey = dto.evidenceKey;
      const path = evidenceKey?.startsWith(prefix) ? evidenceKey.slice(prefix.length).split('/') : [];
      // Hỗ trợ khóa cũ lưu ngay dưới settlements/ và chỉ nhận khóa mới của đúng bảng.
      const validPath =
        (path.length === 1 && Boolean(path[0])) ||
        (path.length === 2 && path[0] === item.id && Boolean(path[1]));
      if (!evidenceKey || !validPath || evidenceKey.includes('..') || evidenceKey.includes('://'))
        throw new BadRequestException(
          'Đường dẫn tệp chứng từ quyết toán không hợp lệ.',
        );
      const paidAt = new Date(dto.paidAt!);
      if (
        !Number.isFinite(paidAt.getTime()) ||
        paidAt > new Date() ||
        paidAt < item.createdAt
      )
        throw new BadRequestException(
          'Thời điểm chuyển khoản phải nằm trong khoảng từ khi lập bảng quyết toán đến hiện tại.',
        );
      if (!(await this.storage.objectExists(evidenceKey)))
        throw new BadRequestException(
          'Tệp chứng từ quyết toán chưa được tải lên.',
        );
      // Đây là xác nhận đối soát thủ công bởi Admin, không phải hàm tự chuyển tiền ngân hàng.
      const updated = await session.updateSettlement(item.id, {
        disbursementStatus: 'SETTLED',
        bankTransferOrderId: dto.bankTransferOrderId,
        transferMemo: dto.transferMemo,
        settledAt: paidAt,
        transferEvidenceKey: evidenceKey,
        confirmedByUserId: actor.id,
      });
      await session.recordFinanceEvent(
        actor.id,
        updated,
        'CONFIRM_SETTLEMENT_TRANSFER',
      );
      return updated;
    });
  }
  private getInvoiceShares(invoice: RevenueInvoice, filter: RevenueFilter) {
    // 15% là phí gộp đã gồm GTGT nếu có. Không trừ VAT toàn gói trước khi tính 85% của CSYT.
    const shares = calculateMonthlyInvoiceShares(invoice, filter);
    if (!shares)
      throw new BadRequestException(
        'Hóa đơn không có ngày phục vụ thuộc kỳ này.',
      );
    return shares;
  }
  private resolveReportingPeriod(query: RevenueAnalyticsQueryDto) {
    this.assertReportingEnvironment(query.environment);
    if ((query.year === undefined) !== (query.month === undefined))
      throw new BadRequestException('Vui lòng cung cấp đầy đủ cả năm và tháng đối soát.');
    const prev = new Date(Date.now() + 7 * 3600000);
    prev.setUTCDate(1);
    prev.setUTCMonth(prev.getUTCMonth() - 1);
    return {
      year: query.year ?? prev.getUTCFullYear(),
      month: query.month ?? prev.getUTCMonth() + 1,
    };
  }

  private assertReportingEnvironment(environment: MonthlySettlementDto['environment']) {
    if (environment === 'TEST' && process.env.NODE_ENV === 'production')
      throw new ForbiddenException('Dữ liệu tài chính TEST bị khóa trong môi trường production.');
  }
}
