import type {
  FamilyPaymentRequestItem,
  IPaymentsService,
  PaymentEligibility,
} from '../interfaces/payments.service.interface';
import type { AuthenticatedUser } from '../../../../core/auth/authenticated-request';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../../../../core/database/prisma.service';
import { PaymentErrorCode } from '../../../../core/constants/error-codes.constant';
import {
  BaseApiException,
  ForbiddenApiException,
} from '../../../../core/exceptions/api.exception';
import { todayInVietnam } from '../../../../core/business/business-helpers';
import { moneyToNumber } from '../../../../core/database/prisma-transaction';
import { randomUUID } from 'node:crypto';

import type { ListTransactionsDto } from '../../dtos/list-transactions.dto';
import type { AdminPaymentRequestDto } from '../../dtos/create-payment-request.dto';
import type { SePayWebhookDto } from '../../dtos/sepay-webhook.dto';
import type {
  ReconciledPaymentResult,
  SePayApiTransaction,
} from '../../sepay/sepay-api.types';
import {
  BillingContractStatus,
  PaymentRequestStatus,
  TransactionOutcome,
  TransactionReason,
  type ActivationResult,
  type BillingContract,
  type PaymentRequest,
  type PaymentRequestStatusView,
  type PaymentTransaction,
  type PaymentTransactionResult,
} from '../../entities/payment.entity';
import {
  addContractMonths,
  missingActivationRequirements,
} from '../../activation/contract-activation';
import { PaymentsClock } from '../../payments.clock';
import { PaymentsConfig } from '../../payments.config';
import { PaymentSettingsService } from '../../settings/payment-settings.service';
import { PaymentConfigurationTestService } from '../../settings/payment-configuration-test.service';
import {
  PAYMENTS_REPOSITORY_TOKEN,
  type PaymentsRepository,
  type PaymentsSession,
} from '../../repositories/interfaces/payments.repository.interface';
import {
  createPaymentCode,
  buildTransferContent,
  extractPaymentCodes,
  parseSePayDate,
  bankTransactionFingerprint,
  transactionFingerprint,
} from '../../sepay/sepay-transaction.helpers';

interface IncomingSePayTransaction {
  providerTransactionId: string;
  webhookTransactionId?: string;
  apiTransactionId?: string;
  gateway: string;
  accountNumber: string;
  transactionAt: Date;
  code?: string | null;
  content: string;
  transferType: 'in' | 'out';
  transferAmount: number;
  referenceCode?: string;
  subAccount?: string | null;
  source: 'WEBHOOK' | 'SEPAY_API';
  reconciliationRunId?: string;
  fingerprint?: string;
  rawPayload: Record<string, unknown>;
}

const BANK_TIME_SKEW_TOLERANCE_MS = 300_000;

@Injectable()
export class PaymentsServiceImpl implements IPaymentsService {
  // Các dependency được NestJS cấp; không tạo kết nối DB/SePay bên trong service.
  constructor(
    @Inject(PAYMENTS_REPOSITORY_TOKEN)
    private readonly repository: PaymentsRepository,
    private readonly config: PaymentsConfig,
    private readonly clock: PaymentsClock,
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly settings?: PaymentSettingsService,
    @Optional() private readonly configurationTests?: PaymentConfigurationTestService,
  ) {}

  private buildFamilyInvoiceInclude() {
    return {
      contract: {
        select: {
          id: true,
          contractNumber: true,
          contractStatus: true,
          startDate: true,
          endDate: true,
          memberCount: true,
          facility: { select: { facilityName: true } },
          servicePackage: { select: { packageName: true } },
        },
      },
      addendum: {
        select: {
          addendumNumber: true,
          addendumType: true,
        },
      },
      paymentTransactions: {
        orderBy: { paymentTime: 'desc' as const },
        take: 1,
      },
      supportCases: {
        where: {
          caseType: 'PAYMENT_ISSUE' as const,
          status: { in: ['OPEN', 'IN_REVIEW', 'NEED_MORE_INFO'] as ('OPEN' | 'IN_REVIEW' | 'NEED_MORE_INFO')[] },
        },
        orderBy: { updatedAt: 'desc' as const },
        take: 1,
        select: {
          id: true,
          caseCode: true,
          status: true,
          updatedAt: true,
        },
      },
    };
  }

  private mapInvoiceRowToFamilyPaymentRequestItem(row: {
    id: string;
    invoiceCode: string;
    transferContent: string | null;
    addendumId?: string | null;
    grossAmount?: unknown;
    vatAmount?: unknown;
    totalPayable: unknown;
    paymentGateway?: string | null;
    paymentStatus: string;
    expectedAccountNumber: string | null;
    expectedGateway: string | null;
    createdAt: Date;
    expiredAt: Date;
    paidAt: Date | null;
    contract: {
      id: string;
      contractNumber: string;
      contractStatus: string;
      startDate?: Date | null;
      endDate?: Date | null;
      memberCount?: number | null;
      facility: { facilityName: string };
      servicePackage: { packageName: string };
    };
    addendum?: {
      addendumNumber: string;
      addendumType: string;
    } | null;
    paymentTransactions: Array<{
      id: string;
      gatewayTransactionId: string;
      amountReceived: unknown;
      paymentTime: Date;
      outcome: string;
      reason: string | null;
      referenceCode: string;
      gateway: string;
    }>;
    supportCases: Array<{
      id: string;
      caseCode: string;
      status: string;
      updatedAt: Date;
    }>;
  }): FamilyPaymentRequestItem {
    const latestTx = row.paymentTransactions[0] ?? null;
    const openCase = row.supportCases[0] ?? null;
    const totalPayable = moneyToNumber(row.totalPayable as any);
    const grossAmountVnd =
      row.grossAmount != null ? moneyToNumber(row.grossAmount as any) : totalPayable;
    const vatAmountVnd =
      row.vatAmount != null ? moneyToNumber(row.vatAmount as any) : 0;

    return {
      id: row.id,
      contractId: row.contract.id,
      contractNumber: row.contract.contractNumber,
      contractStatus: row.contract.contractStatus,
      packageName: row.contract.servicePackage.packageName,
      facilityName: row.contract.facility.facilityName,
      paymentCode: row.invoiceCode,
      transferContent: row.transferContent ?? row.invoiceCode,
      amountVnd: totalPayable,
      grossAmountVnd,
      vatAmountVnd,
      paymentGateway: row.paymentGateway ?? 'VIETQR',
      addendumId: row.addendumId ?? null,
      addendumNumber: row.addendum?.addendumNumber ?? null,
      addendumType: row.addendum?.addendumType ?? null,
      contractStartDate: row.contract.startDate?.toISOString() ?? null,
      contractEndDate: row.contract.endDate?.toISOString() ?? null,
      memberCount: row.contract.memberCount ?? undefined,
      status: row.paymentStatus,
      expectedAccountNumber: row.expectedAccountNumber,
      expectedGateway: row.expectedGateway,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiredAt.toISOString(),
      paidAt: row.paidAt?.toISOString() ?? null,
      latestTransaction: latestTx
        ? {
            id: latestTx.id,
            providerTransactionId: latestTx.gatewayTransactionId,
            amountReceived: moneyToNumber(latestTx.amountReceived as any),
            paymentTime: latestTx.paymentTime.toISOString(),
            outcome: latestTx.outcome,
            reason: latestTx.reason,
            referenceCode: latestTx.referenceCode,
            gateway: latestTx.gateway,
          }
        : null,
      openSupportCase: openCase
        ? {
            id: openCase.id,
            caseCode: openCase.caseCode,
            status: openCase.status,
            updatedAt: openCase.updatedAt.toISOString(),
          }
        : null,
    };
  }

  async listMyPaymentRequests(
    actor: AuthenticatedUser,
  ): Promise<FamilyPaymentRequestItem[]> {
    if (actor.role !== 'FAMILY_REP') {
      throw new ForbiddenException(
        'Chỉ đại diện hộ gia đình mới có quyền xem lịch sử yêu cầu thanh toán của hộ mình.',
      );
    }
    if (!this.prisma) {
      return [];
    }
    const include = this.buildFamilyInvoiceInclude();
    const baseWhere = {
      contract: {
        familyUnit: { representativeUserId: actor.id },
      },
    };
    const [priorityRows, archiveRows] = await Promise.all([
      this.prisma.invoice.findMany({
        where: {
          ...baseWhere,
          paymentStatus: { in: ['PAID', 'PENDING'] },
        },
        orderBy: { createdAt: 'desc' },
        include,
      }),
      this.prisma.invoice.findMany({
        where: {
          ...baseWhere,
          paymentStatus: { in: ['EXPIRED', 'CANCELLED'] },
        },
        orderBy: { createdAt: 'desc' },
        take: 30,
        include,
      }),
    ]);

    const mergedById = new Map<string, (typeof priorityRows)[number]>();
    for (const row of [...priorityRows, ...archiveRows]) {
      if (!mergedById.has(row.id)) {
        mergedById.set(row.id, row);
      }
    }

    return [...mergedById.values()]
      .filter(
        (row): row is typeof row & { contract: NonNullable<typeof row.contract> } =>
          Boolean(row.contract),
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((row) => this.mapInvoiceRowToFamilyPaymentRequestItem(row as any));
  }

  // Lấy số tiền đã chốt trong hợp đồng/phụ lục. Khách không được tự truyền giá vào API.
  async createVietQRPayment(
    contractId: string,
    addendumId?: string,
    actor?: AuthenticatedUser,
  ): Promise<PaymentRequest> {
    return this.issuePayment(contractId, addendumId, actor);
  }

  createAdminPaymentRequest(dto: AdminPaymentRequestDto, actor: AuthenticatedUser, ip?: string) {
    if (actor.role !== 'ADMIN') throw new ForbiddenException('Chỉ Admin được điều chỉnh yêu cầu thanh toán.');
    if (extractPaymentCodes({ content: dto.transferDescription }).length) {
      throw new BadRequestException('Nội dung không được chứa mã FD của hóa đơn. Hệ thống tự thêm mã mới.');
    }
    return this.issuePayment(dto.contractId, dto.addendumId, actor, { dto, actorId: actor.id, ip });
  }

  async getAdminPaymentEligibility(contractId: string, addendumId: string | undefined, actor: AuthenticatedUser): Promise<PaymentEligibility> {
    if (actor.role !== 'ADMIN') {
      throw new ForbiddenException('Chỉ Admin được kiểm tra điều kiện tạo mã thu tiền.');
    }
    if (this.settings) await this.settings.resolveSnapshot(this.config.getEnvironment());
    else this.config.getDestination();
    return this.repository.transaction(async (session) => {
      const contract = await this.requireContract(session, contractId, addendumId);
      const result = await this.checkIssueEligibility(session, contract);
      return result.eligible ? { eligible: true, blockingReasons: [] } : result;
    });
  }

  // Dùng cùng điều kiện lúc xem trước và lúc tạo mã để hai chỗ báo giống nhau.
  private async checkIssueEligibility(
    session: PaymentsSession,
    contract: BillingContract,
  ): Promise<
    | { eligible: true; requests: PaymentRequest[] }
    | { eligible: false; message: string; blockingReasons: string[] }
  > {
    if ((this.config.getEnvironment() === 'TEST') !== contract.simulation) {
      return {
        eligible: false,
        message:
          'Hợp đồng dữ liệu thử và hợp đồng thật phải dùng hai môi trường thanh toán riêng biệt.',
        blockingReasons: [],
      };
    }
    if (contract.status !== BillingContractStatus.PENDING) {
      return {
        eligible: false,
        message: contract.addendumId
          ? 'Phụ lục hợp đồng không còn ở trạng thái chờ thanh toán.'
          : 'Hợp đồng không ở trạng thái chờ thanh toán (nếu hợp đồng đang hiệu lực, vui lòng chọn kèm phụ lục chờ thanh toán).',
        blockingReasons: [],
      };
    }
    if (
      contract.holdExpiresAt &&
      Date.parse(contract.holdExpiresAt) <= this.clock.now().getTime()
    ) {
      return {
        eligible: false,
        message: 'Đã quá thời hạn thanh toán gia hạn hợp đồng.',
        blockingReasons: ['RENEWAL_PAYMENT_EXPIRED'],
      };
    }
    const missing = missingActivationRequirements(contract.requirements);
    if (missing.length) {
      return {
        eligible: false,
        message: contract.addendumId
          ? 'Phụ lục hợp đồng chưa đủ điều kiện thanh toán.'
          : 'Hợp đồng chưa đủ điều kiện thanh toán.',
        blockingReasons: missing,
      };
    }
    if (await this.otherActiveContractExists(session, contract)) {
      return {
        eligible: false,
        message: 'Hộ gia đình đã có một hợp đồng khác đang hiệu lực.',
        blockingReasons: [],
      };
    }
    const requests = await session.listRequests(contract.id, contract.addendumId);
    if (requests.some((item) => item.status === PaymentRequestStatus.PAID)) {
      return {
        eligible: false,
        message: contract.addendumId
          ? 'Phụ lục hợp đồng này đã được ghi nhận thanh toán.'
          : 'Hợp đồng này đã được ghi nhận thanh toán.',
        blockingReasons: [],
      };
    }
    return { eligible: true, requests };
  }

  private async issuePayment(
    contractId: string,
    addendumId: string | undefined,
    actor: AuthenticatedUser | undefined,
    adjustment?: { dto: AdminPaymentRequestDto; actorId: string; ip?: string },
  ): Promise<PaymentRequest> {
    const destination = this.settings ? await this.settings.resolveSnapshot(this.config.getEnvironment()) : this.config.getDestination();
    return this.repository.transaction(async (session) => {
      const contract = await this.requireContract(
        session,
        contractId,
        addendumId,
      );
      this.assertPaymentOwner(contract, actor);
      const eligibility = await this.checkIssueEligibility(session, contract);
      if (!eligibility.eligible) {
        throw new ConflictException({
          message: eligibility.message,
          blockingReasons: eligibility.blockingReasons,
        });
      }
      const { requests } = eligibility;
      const now = this.clock.now();
      const pending = requests.find(
        (item) =>
          item.status === PaymentRequestStatus.PENDING &&
          Date.parse(item.expiresAt) > now.getTime(),
      );
      // Cùng số tiền và nội dung thì dùng lại mã còn hạn.
      if (pending && (!adjustment || (
        pending.amountVnd === adjustment.dto.amountVnd &&
        pending.adminTransferDescription === adjustment.dto.transferDescription
      ))) return this.withQrCode(pending);
      // Những yêu cầu cũ quá hạn được đóng trước khi cấp mã mới, không tái sử dụng mã cũ.
      for (const item of requests) {
        if (item.status === PaymentRequestStatus.PENDING) {
          item.status = item === pending ? PaymentRequestStatus.CANCELLED : PaymentRequestStatus.EXPIRED;
          await session.saveRequest(item);
        }
      }
      // Giá chụp trong hợp đồng không thay đổi nếu danh mục công bố phiên bản gói mới.
      const previous = requests.at(-1) ?? null;
      const previousOverride = previous?.adminTransferDescription ? previous : undefined;
      const originalAmountVnd = contract.packageSnapshot.pricing.totalPriceVnd;
      const amount = adjustment?.dto.amountVnd ?? previousOverride?.amountVnd ?? originalAmountVnd;
      const description = adjustment?.dto.transferDescription ?? previousOverride?.adminTransferDescription;
      if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 9999999999)
        throw new BadRequestException('Số tiền thanh toán của hợp đồng không hợp lệ.');
      let payment!: PaymentRequest;
      for (let attemptIdx = 0; attemptIdx < 5; attemptIdx += 1) {
        const paymentCode = createPaymentCode();
        payment = {
          id: randomUUID(),
          contractId,
          familyId: contract.familyId,
          environment: this.config.getEnvironment(),
          addendumId,
          attempt: (requests.at(-1)?.attempt ?? 0) + 1,
          paymentCode,
          transferContent: description
            ? `${paymentCode} ${description}`
            : buildTransferContent(contract.payerDisplayName, paymentCode),
          adminTransferDescription: description,
          amountVnd: amount,
          currency: 'VND',
          expectedAccountNumber: destination.accountNumber,
          expectedGateway: destination.gateway,
          status: PaymentRequestStatus.PENDING,
          createdAt: now.toISOString(),
          expiresAt: new Date(
            contract.holdExpiresAt
              ? Math.min(
                  now.getTime() + destination.ttlMinutes * 60_000,
                  Date.parse(contract.holdExpiresAt),
                )
              : now.getTime() + destination.ttlMinutes * 60_000,
          ).toISOString(),
          paidAt: null,
          acceptedTransactionId: null,
        };
        try {
          await session.saveRequest(payment);
          break;
        } catch (err) {
          const isUniqueConflict =
            typeof err === 'object' &&
            err !== null &&
            (err as { code?: string }).code === 'P2002';
          if (!isUniqueConflict || attemptIdx === 4) throw err;
        }
      }
      if (adjustment) {
        await session.recordPaymentOverride({
          actorId: adjustment.actorId,
          clientIp: adjustment.ip?.slice(0, 45) ?? 'unknown',
          request: payment,
          previous,
          originalAmountVnd,
          reason: adjustment.dto.reason,
        });
      }
      return this.withQrCode(payment);
    });
  }

  async getPaymentStatus(
    id: string,
    actor?: AuthenticatedUser,
  ): Promise<PaymentRequestStatusView> {
    this.config.assertPaymentsEnabled();
    return this.repository.transaction(async (session) => {
      const item = await this.requireRequest(session, id);
      this.assertPaymentOwner(item, actor);
      // Nếu mã đã quá 15 phút thì đóng mã. Gọi lại API tạo thanh toán sẽ nhận mã mới.
      if (
        item.status === PaymentRequestStatus.PENDING &&
        Date.parse(item.expiresAt) <= this.clock.now().getTime()
      ) {
        item.status = PaymentRequestStatus.EXPIRED;
        await session.saveRequest(item);
      }
      const view: PaymentRequestStatusView = this.withQrCode(item);
      // Bề mặt hóa trạng thái sau thanh toán để gia đình không bị "màn hình thành công giả".
      if (item.status === PaymentRequestStatus.PAID) {
        const contract = await session.findContract(
          item.contractId,
          item.addendumId,
        );
        if (contract) {
          if (contract.status === BillingContractStatus.ACTIVE) {
            view.activation = { activated: true, blockingReasons: [] };
          } else if (
            contract.status === BillingContractStatus.PENDING_ACTIVATION
          ) {
            view.activation = {
              activated: false,
              blockingReasons: ['AWAITING_START_DATE'],
            };
          } else {
            view.activation = {
              activated: false,
              blockingReasons: (
                await this.evaluateActivation(session, contract)
              ).blockingReasons,
            };
          }
        }
      } else if (
        item.status === PaymentRequestStatus.PENDING ||
        item.status === PaymentRequestStatus.EXPIRED ||
        item.status === PaymentRequestStatus.CANCELLED
      ) {
        // Tiền có thể đã vào nhưng đang soát xét (LATE_PAYMENT, WRONG_ACCOUNT...):
        // bề mặt hóa giao dịch gần nhất để gia đình biết mà không nhầm là "chưa ghi nhận".
        const latest =
          await session.findLatestTransactionByRequestId(item.id);
        if (latest)
          view.latestTransaction = {
            id: latest.id,
            outcome: latest.outcome,
            reason: latest.reason,
            referenceCode: latest.referenceCode || null,
            amountVnd: latest.amountVnd,
            receivedAt: latest.receivedAt,
          };
      }
      return view;
    });
  }

  async cancelRequest(
    id: string,
    actor?: AuthenticatedUser,
  ): Promise<PaymentRequest> {
    // Hủy mã chờ trả tiền, không hoàn tiền và không thanh lý hợp đồng đã thanh toán.
    this.config.assertPaymentsEnabled();
    return this.repository.transaction(async (session) => {
      const item = await this.requireRequest(session, id);
      this.assertPaymentOwner(item, actor);
      if (item.status === PaymentRequestStatus.PAID)
        throw new ConflictException(
          'Không thể hủy yêu cầu thanh toán đã được xác nhận chi trả.',
        );
      if (item.status === PaymentRequestStatus.PENDING) {
        item.status =
          Date.parse(item.expiresAt) <= this.clock.now().getTime()
            ? PaymentRequestStatus.EXPIRED
            : PaymentRequestStatus.CANCELLED;
        await session.saveRequest(item);
      }
      return item;
    });
  }

  async listTransactions(query: ListTransactionsDto) {
    this.config.assertPaymentsEnabled();
    return this.repository.transaction(async (session) => {
      const search = query.search?.trim().toLowerCase();
      const items = (await session.listTransactions()).filter((item) => {
        if (query.outcome && item.outcome !== query.outcome) return false;
        if (query.transferType && item.transferType !== query.transferType)
          return false;
        if (search) {
          const haystacks = [
            item.providerTransactionId,
            item.paymentCode,
            item.referenceCode,
            item.transferContent,
            item.contractNumber,
            item.payerName,
          ];
          if (
            !haystacks.some(
              (val) => typeof val === 'string' && val.toLowerCase().includes(search),
            )
          ) {
            return false;
          }
        }
        return true;
      });
      const summary = {
        totalInVnd: items
          .filter((i) => i.transferType === 'in')
          .reduce((sum, i) => sum + i.amountVnd, 0),
        totalOutVnd: items
          .filter((i) => i.transferType === 'out')
          .reduce((sum, i) => sum + i.amountVnd, 0),
        reviewRequiredCount: items.filter(
          (i) => i.outcome === TransactionOutcome.REVIEW_REQUIRED,
        ).length,
      };
      return {
        items: items.slice(
          (query.page - 1) * query.limit,
          query.page * query.limit,
        ),
        total: items.length,
        page: query.page,
        limit: query.limit,
        summary,
      };
    });
  }

  // Guard đã kiểm tra nguồn webhook. Từ đây đối chiếu từng giao dịch với hóa đơn trong DB.
  async handleVietQRWebhook(
    dto: SePayWebhookDto,
  ): Promise<PaymentTransactionResult> {
    return this.handleIncomingTransaction({
      providerTransactionId: String(dto.id),
      webhookTransactionId: String(dto.id),
      gateway: dto.gateway,
      accountNumber: dto.accountNumber,
      transactionAt: parseSePayDate(dto.transactionDate),
      code: dto.code,
      content: dto.content,
      transferType: dto.transferType,
      transferAmount: dto.transferAmount,
      referenceCode: dto.referenceCode,
      subAccount: dto.subAccount,
      source: 'WEBHOOK',
      fingerprint: transactionFingerprint(dto),
      rawPayload: Object.fromEntries(Object.entries(dto)),
    });
  }

  async handleSePayApiTransaction(
    item: SePayApiTransaction,
    reconciliationRunId: string,
  ): Promise<ReconciledPaymentResult> {
    const transactionAt = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(
      item.transaction_date,
    )
      ? parseSePayDate(item.transaction_date)
      : new Date(item.transaction_date);
    if (!Number.isFinite(transactionAt.getTime()))
      throw new BadRequestException('Invalid SePay API transaction_date');
    const testDelivery = this.configurationTests ? await this.configurationTests.dispatch({ environment: this.config.getEnvironment(), source: 'SEPAY_API', providerTransactionId: item.id,
      gateway: item.bank_brand_name, accountNumber: item.account_number, bankAccountId: item.bank_account_id,
      amountVnd: item.amount_in, text: `${item.code ?? ''} ${item.transaction_content}`, transactionAt, transferType: item.transfer_type }) : { handled: false };
    const amount = testDelivery.handled ? 0 :
      item.transfer_type === 'in' ? item.amount_in : item.amount_out;
    if (amount === 0) {
      console.warn('[SEPAY_API_ZERO_AMOUNT_SKIPPED]', { apiTransactionId: item.id });
      const nowIso = this.clock.now().toISOString();
      return {
        testOnly: testDelivery.handled,
        duplicate: true,
        linked: false,
        transaction: {
          id: randomUUID(),
          environment: this.config.getEnvironment(),
          providerTransactionId: `sepay-v2:${item.id}`,
          fingerprint: '',
          bankReferenceKey: null,
          gateway: item.bank_brand_name,
          accountNumber: item.account_number,
          transferType: item.transfer_type,
          amountVnd: 0,
          paymentCode: null,
          paymentRequestId: null,
          referenceCode: item.reference_number ?? '',
          transactionAt: transactionAt.toISOString(),
          receivedAt: nowIso,
          outcome: TransactionOutcome.IGNORED,
          reason: null,
          sepayApiTransactionId: item.id,
          ingestionSource: 'SEPAY_API',
          reconciledAt: nowIso,
          reconciliationRunId,
        },
      };
    }
    if (!Number.isSafeInteger(amount) || amount < 0)
      throw new BadRequestException('Invalid SePay API transaction amount');
    const result = await this.handleIncomingTransaction({
      providerTransactionId: `sepay-v2:${item.id}`,
      apiTransactionId: item.id,
      gateway: item.bank_brand_name,
      accountNumber: item.account_number,
      transactionAt,
      code: item.code,
      content: item.transaction_content,
      transferType: item.transfer_type,
      transferAmount: amount,
      referenceCode: item.reference_number ?? '',
      source: 'SEPAY_API',
      reconciliationRunId,
      rawPayload: { ...item },
    });
    return {
      duplicate: result.duplicate,
      linked: result.linked,
      transaction: result.transaction,
    };
  }

  private async handleIncomingTransaction(
    incoming: IncomingSePayTransaction,
  ): Promise<PaymentTransactionResult & { linked: boolean }> {
    this.config.assertPaymentsEnabled();
    const fingerprint =
      incoming.fingerprint ??
      bankTransactionFingerprint({
        providerTransactionId: incoming.providerTransactionId,
        gateway: incoming.gateway,
        accountNumber: incoming.accountNumber,
        transactionDate: incoming.transactionAt.toISOString(),
        transferType: incoming.transferType,
        transferAmount: incoming.transferAmount,
        code: incoming.code,
        content: incoming.content,
        referenceCode: incoming.referenceCode,
        subAccount: incoming.subAccount,
      });
    console.log('[DEBUG_CP05][WEBHOOK_SERVICE_START]', {
      sepayId: incoming.providerTransactionId,
      parsedDate: incoming.transactionAt.toISOString(),
      fingerprint,
      env: this.config.getEnvironment(),
      source: incoming.source,
    });
    return this.repository.transaction(async (session) => {
      const previous = incoming.apiTransactionId
        ? await session.findTransactionByApiId(incoming.apiTransactionId)
        : await session.findTransactionByWebhookId(
            incoming.webhookTransactionId!,
          );
      if (previous) {
        console.log('[DEBUG_CP06][WEBHOOK_IDEMPOTENT_CHECK]', {
          isDuplicate: true,
          previousId: previous.id,
          fingerprintMatch: previous.fingerprint === fingerprint,
        });
        if (
          (previous.providerTransactionId === incoming.providerTransactionId &&
            previous.fingerprint !== fingerprint) ||
          !this.isSameBankTransaction(previous, incoming)
        )
          throw new ConflictException(
            'Provider transaction ID reused with different data',
          );
        // Retry đúng dữ liệu chỉ trả kết quả cũ, không cộng tiền hay kéo dài hợp đồng.
        return {
          duplicate: true,
          linked: false,
          transaction: previous,
          activation: null,
        };
      }
      console.log('[DEBUG_CP06][WEBHOOK_IDEMPOTENT_CHECK]', {
        isDuplicate: false,
        sepayId: incoming.providerTransactionId,
      });
      const reference = incoming.referenceCode?.trim() ?? '';
      const bankReferenceKey = reference
        ? JSON.stringify([
            incoming.gateway.trim().toUpperCase(),
            incoming.accountNumber,
            reference,
          ])
        : null;
      if (bankReferenceKey) {
        const byReference = await session.findTransactionByBankIdentity(
          incoming.accountNumber,
          reference,
        );
        const crossSource =
          (Boolean(incoming.apiTransactionId) &&
            Boolean(byReference?.sepayWebhookTransactionId)) ||
          (Boolean(incoming.webhookTransactionId) &&
            Boolean(byReference?.sepayApiTransactionId));
        if (
          byReference &&
          crossSource &&
          this.isSameBankTransaction(byReference, incoming)
        ) {
          const linked = await session.linkReconciledTransaction(
            byReference.id,
            {
              sepayWebhookTransactionId: incoming.webhookTransactionId,
              sepayApiTransactionId: incoming.apiTransactionId,
              reconciliationRunId: incoming.reconciliationRunId,
              reconciledAt:
                incoming.source === 'SEPAY_API'
                  ? this.clock.now().toISOString()
                  : undefined,
            },
          );
          return {
            duplicate: true,
            linked: true,
            transaction: linked,
            activation: null,
          };
        }
      }
      const codes = extractPaymentCodes(incoming);
      // Mặc định giữ để kiểm tra; chỉ chuyển MATCHED sau khi mọi phép đối chiếu đều đạt.
      const record: PaymentTransaction = {
        id: randomUUID(),
        environment: this.config.getEnvironment(),
        providerTransactionId: incoming.providerTransactionId,
        fingerprint,
        bankReferenceKey,
        gateway: incoming.gateway,
        accountNumber: incoming.accountNumber,
        transferType: incoming.transferType,
        amountVnd: incoming.transferAmount,
        paymentCode: codes.length === 1 ? codes[0] : null,
        paymentRequestId: null,
        referenceCode: reference,
        transactionAt: incoming.transactionAt.toISOString(),
        receivedAt: this.clock.now().toISOString(),
        outcome: TransactionOutcome.REVIEW_REQUIRED,
        reason: null,
        sepayWebhookTransactionId: incoming.webhookTransactionId ?? null,
        sepayApiTransactionId: incoming.apiTransactionId ?? null,
        ingestionSource: incoming.source,
        reconciledAt:
          incoming.source === 'SEPAY_API'
            ? this.clock.now().toISOString()
            : null,
        reconciliationRunId: incoming.reconciliationRunId ?? null,
        rawPayload: incoming.rawPayload,
      };
      let payment: PaymentRequest | null = null;
      if (record.paymentCode) {
        payment = await session.findRequestByCode(record.paymentCode);
        record.paymentRequestId = payment?.id ?? null;
      }
      console.log('[DEBUG_CP07][WEBHOOK_EXTRACT_PAYMENT_CODE]', {
        extractedCodes: codes,
        chosenCode: record.paymentCode,
        paymentRequestFound: !!payment,
        paymentRequestId: payment?.id ?? null,
        expectedAmount: payment?.amountVnd ?? null,
        receivedAmount: record.amountVnd,
      });
      const reason = await this.reconciliationReason(
        session,
        record,
        payment,
        codes.length,
      );
      console.log('[DEBUG_CP08][WEBHOOK_RECONCILIATION_RESULT]', {
        matched: !reason,
        reason: reason ?? 'NONE (VALID_MATCH)',
      });
      // Giao dịch sai vẫn được lưu để kiểm tra, không bị "mất tiền" trong nhật ký ứng dụng.
      if (reason) {
        record.reason = reason;
        record.outcome =
          reason === TransactionReason.OUTGOING_TRANSFER
            ? TransactionOutcome.IGNORED
            : TransactionOutcome.REVIEW_REQUIRED;
        console.log('[DEBUG_CP09][WEBHOOK_TRANSACTION_REVIEW_REQUIRED]', {
          recordId: record.id,
          reason,
          outcome: record.outcome,
        });
        await session.saveTransaction(record);
        return {
          duplicate: false,
          linked: false,
          transaction: record,
          activation: null,
        };
      }
      // Sau đối chiếu, payment chắc chắn tồn tại. Không gộp các khoản thiếu/thừa để tự trả đủ.
      if (!payment) throw new NotFoundException('Payment request not found');
      record.outcome = TransactionOutcome.MATCHED;
      payment.status = PaymentRequestStatus.PAID;
      payment.paidAt = new Date(
        Math.max(
          Date.parse(record.transactionAt),
          Date.parse(payment.createdAt),
        ),
      ).toISOString();
      payment.acceptedTransactionId = record.id;
      console.log('[DEBUG_CP10][WEBHOOK_TRANSACTION_MATCHED]', {
        recordId: record.id,
        paymentRequestId: payment.id,
        contractId: payment.contractId,
        addendumId: payment.addendumId,
      });
      // Ba thay đổi dưới đây nằm chung transaction, tránh PAID nhưng thiếu sổ giao dịch.
      await session.saveTransaction(record);
      await session.saveRequest(payment);
      const contract = await this.requireContract(
        session,
        payment.contractId,
        payment.addendumId,
      );
      let activation;
      if (
        !payment.addendumId &&
        !contract.upgradedFromId &&
        this.prisma &&
        (contract as { status?: string }).status === 'PENDING_PAYMENT'
      ) {
        const sigCount = await this.prisma.contractSignature.count({
          where: { contractId: contract.id },
        });
        if (sigCount < 4) {
          const paidAtMs = payment.paidAt
            ? Date.parse(payment.paidAt)
            : Date.now();
          await this.prisma.medicalContract.update({
            where: { id: contract.id },
            data: {
              contractStatus: 'PAID_PENDING_APPROVAL',
              approvalDeadlineAt: new Date(paidAtMs + 24 * 60 * 60 * 1000),
            },
          });
          activation = {
            contractId: contract.id,
            status: BillingContractStatus.PENDING,
            activated: false,
            blockingReasons: ['AWAITING_FACILITY_AND_DOCTOR_APPROVAL'],
          };
        } else {
          activation = await this.activateInTransaction(session, contract);
        }
      } else {
        activation = await this.activateInTransaction(session, contract);
      }
      console.log('[DEBUG_CP11][WEBHOOK_CONTRACT_ACTIVATION_RESULT]', {
        contractId: activation.contractId,
        status: activation.status,
        activated: activation.activated,
        blockingReasons: activation.blockingReasons,
      });
      if (activation.activated) {
        console.log('[AUTO_ACTIVATION][WEBHOOK]', {
          paymentId: payment.id,
          contractId: payment.contractId,
          paymentCode: payment.paymentCode,
          amountVnd: payment.amountVnd,
          reason: 'time_check_skipped_auto_activation',
        });
      }
      return {
        duplicate: false,
        linked: false,
        transaction: record,
        activation,
      };
    });
  }

  private isSameBankTransaction(
    existing: PaymentTransaction,
    incoming: IncomingSePayTransaction,
  ) {
    return (
      existing.accountNumber === incoming.accountNumber &&
      existing.transferType === incoming.transferType &&
      existing.amountVnd === incoming.transferAmount &&
      existing.referenceCode === (incoming.referenceCode?.trim() ?? '') &&
      Date.parse(existing.transactionAt) === incoming.transactionAt.getTime()
    );
  }

  async tryActivate(
    contractId: string,
    addendumId?: string,
  ): Promise<ActivationResult> {
    this.config.assertPaymentsEnabled();
    return this.repository.transaction(async (session) => {
      return this.activateInTransaction(
        session,
        await this.requireContract(session, contractId, addendumId),
      );
    });
  }

  // Kích hoạt bù an toàn: FAMILY_REP chỉ được yêu cầu cho hóa đơn đã PAID của chính hộ mình,
  // ADMIN thì giữ quyền như cũ. Giao dịch chưa PAID không thể kích hoạt nên từ chối sớm.
  async recheckActivation(
    paymentId: string,
    actor?: AuthenticatedUser,
  ): Promise<ActivationResult> {
    this.config.assertPaymentsEnabled();
    return this.repository.transaction(async (session) => {
      const payment = await this.requireRequest(session, paymentId);
      if (actor && actor.role !== 'ADMIN') {
        if (
          actor.role !== 'FAMILY_REP' ||
          actor.familyUnitId !== payment.familyId
        )
          throw new ForbiddenApiException(
            PaymentErrorCode.PAYMENT_RECHECK_FORBIDDEN,
            'Chỉ gia đình sở hữu thanh toán hoặc quản trị viên mới được kiểm tra lại kích hoạt.',
          );
        if (payment.status !== PaymentRequestStatus.PAID)
          throw new BaseApiException({
            errorCode: PaymentErrorCode.PAYMENT_NOT_RECORDED,
            status: HttpStatus.BAD_REQUEST,
            message:
              'Chỉ có thể kiểm tra lại kích hoạt sau khi hệ thống đã ghi nhận thanh toán.',
            conditions: [
              {
                code: 'PAYMENT_PAID',
                condition: 'Thanh toán phải ở trạng thái PAID',
                message: `Thanh toán đang ở trạng thái ${payment.status}, hệ thống chưa ghi nhận tiền về.`,
              },
            ],
          });
      }
      return this.activateInTransaction(
        session,
        await this.requireContract(session, payment.contractId, payment.addendumId),
      );
    });
  }

  // Chỉ đánh giá điều kiện kích hoạt, không ghi dữ liệu: dùng cho cả tra cứu (getPaymentStatus)
  // lẫn nhánh kiểm tra trước khi ghi hợp đồng ACTIVE trong activateInTransaction.
  private async evaluateActivation(
    session: PaymentsSession,
    contract: BillingContract,
  ): Promise<{ paid: boolean; blockingReasons: string[] }> {
    const reasons = missingActivationRequirements(contract.requirements);
    if (contract.status === BillingContractStatus.CANCELLED)
      reasons.push('CONTRACT_CANCELLED');
    const paid = (
      await session.listRequests(contract.id, contract.addendumId)
    ).some((item) => item.status === PaymentRequestStatus.PAID);
    if (!paid) reasons.push('VERIFIED_PAYMENT_REQUIRED');
    if (await this.otherActiveContractExists(session, contract))
      reasons.push('FAMILY_ALREADY_HAS_ACTIVE_CONTRACT');
    return { paid, blockingReasons: reasons };
  }

  // Mỗi nhánh trả một lý do rõ ràng; không tự suy đoán khi thông tin thanh toán mơ hồ.
  private async reconciliationReason(
    session: PaymentsSession,
    record: PaymentTransaction,
    payment: PaymentRequest | null,
    codeCount: number,
  ): Promise<TransactionReason | null> {
    if (record.transferType !== 'in')
      return TransactionReason.OUTGOING_TRANSFER;
    if (
      record.bankReferenceKey &&
      (await session.findTransactionByReference(record.bankReferenceKey))
    ) {
      return TransactionReason.DUPLICATE_BANK_REFERENCE;
    }
    if (!codeCount) return TransactionReason.MISSING_CODE;
    if (codeCount > 1) return TransactionReason.AMBIGUOUS_CODE;
    if (!payment) return TransactionReason.UNKNOWN_CODE;
    if (
      record.accountNumber !== payment.expectedAccountNumber ||
      record.gateway.trim().toUpperCase() !==
        payment.expectedGateway.trim().toUpperCase()
    )
      return TransactionReason.WRONG_ACCOUNT;
    // Chỉ nhận đúng số tiền trọn yêu cầu; thiếu/thừa không tự bù trừ hoặc tự hoàn.
    if (record.amountVnd !== payment.amountVnd)
      return TransactionReason.AMOUNT_MISMATCH;
    const bankTime = Date.parse(record.transactionAt);
    // Chấp nhận dung sai 5 phút hai chiều để chịu được ngân hàng cắt giây về :00 (MBBank) và lệch đồng hồ.
    // Bỏ qua kiểm tra thời gian (BEFORE_REQUEST, LATE_PAYMENT, SUPERSEDED_REQUEST)
    // khi mã và số tiền khớp để tự động kích hoạt hợp đồng.
    // if (bankTime < Date.parse(payment.createdAt) - BANK_TIME_SKEW_TOLERANCE_MS)
    //   return TransactionReason.BEFORE_REQUEST;
    if (bankTime > this.clock.now().getTime() + BANK_TIME_SKEW_TOLERANCE_MS)
      return TransactionReason.FUTURE_TRANSACTION;
    if (payment.status === PaymentRequestStatus.CANCELLED)
      return TransactionReason.CANCELLED_REQUEST;
    if (payment.status === PaymentRequestStatus.PAID)
      return TransactionReason.ALREADY_PAID;
    const contract = await session.findContract(
      payment.contractId,
      payment.addendumId,
    );
    if (!contract || contract.status !== BillingContractStatus.PENDING)
      return TransactionReason.CONTRACT_UNAVAILABLE;
    // Bỏ qua SUPERSEDED_REQUEST: cho phép giao dịch vào mã cũ nếu mã và tiền khớp.
    // if (attempts.at(-1)?.id !== payment.id)
    //   return TransactionReason.SUPERSEDED_REQUEST;
    // Bỏ qua LATE_PAYMENT: cho phép giao dịch sau khi mã hết hạn nếu mã và tiền khớp.
    // if (bankTime >= Date.parse(payment.expiresAt))
    //   return TransactionReason.LATE_PAYMENT;
    // Callback đến muộn vẫn được chấp nhận nếu tiền vào trong hạn và chưa có mã thay thế.
    return null;
  }

  // Đã nhận đủ tiền vẫn phải kiểm tra chữ ký, phân công và sức chứa trước khi cấp quyền.
  private async activateInTransaction(
    session: PaymentsSession,
    contract: BillingContract,
  ): Promise<ActivationResult> {
    // Gọi lại an toàn: giữ nguyên ngày hiệu lực, không kéo dài thêm một kỳ.
    if (contract.status === BillingContractStatus.ACTIVE) {
      return {
        contractId: contract.id,
        status: contract.status,
        activated: true,
        blockingReasons: [],
      };
    }
    // Kiểm tra lại sau khi tiền vào vì phân công/sức chứa có thể đã đổi từ lúc tạo mã.
    const { blockingReasons: reasons } = await this.evaluateActivation(
      session,
      contract,
    );
    // Thiếu bất kỳ điều kiện nào thì giữ PENDING nhưng vẫn bảo toàn trạng thái PAID.
    if (reasons.length)
      return {
        contractId: contract.id,
        status: contract.status,
        activated: false,
        blockingReasons: reasons,
      };
    // Chỉ tạo khoảng hiệu lực sau khi đã vượt toàn bộ cổng điều kiện.
    const now = this.clock.now();
    if (
      contract.upgradedFromId &&
      contract.plannedFrom &&
      todayInVietnam(new Date(contract.plannedFrom)) > todayInVietnam(now)
    ) {
      contract.status = BillingContractStatus.PENDING_ACTIVATION;
      contract.updatedAt = now.toISOString();
      await session.saveContract(contract);
      return {
        contractId: contract.id,
        status: contract.status,
        activated: false,
        blockingReasons: ['AWAITING_START_DATE'],
      };
    }

    const startDate = contract.upgradedFromId
      ? todayInVietnam(now)
      : contract.plannedFrom
        ? new Date(contract.plannedFrom)
        : now;
    const endDate = contract.upgradedFromId
      ? addContractMonths(
          startDate,
          contract.packageSnapshot.package.durationMonths,
        )
      : contract.plannedUntil
        ? new Date(contract.plannedUntil)
        : addContractMonths(
            now,
            contract.packageSnapshot.package.durationMonths,
          );

    contract.status = BillingContractStatus.ACTIVE;
    contract.activeFrom = startDate.toISOString();
    contract.activeUntil = endDate.toISOString();
    contract.updatedAt = now.toISOString();
    await session.saveContract(contract);
    return {
      contractId: contract.id,
      status: contract.status,
      activated: true,
      blockingReasons: [],
    };
  }

  private withQrCode(payment: PaymentRequest): PaymentRequest {
    if (process.env.PAYMENTS_MODE === 'simulation')
      return { ...payment, qrUrl: null };
    const url = new URL('https://vietqr.app/img');
    // QR chứa sẵn tài khoản nhận, đúng số tiền hóa đơn và nội dung ghép giao dịch.
    // Người dùng chỉ quét và xác nhận trên app ngân hàng; không nhập lại ba thông tin này.
    url.searchParams.set('acc', payment.expectedAccountNumber);
    url.searchParams.set('bank', payment.expectedGateway);
    url.searchParams.set('amount', String(payment.amountVnd));
    url.searchParams.set('des', payment.transferContent ?? payment.paymentCode);
    // qronly giữ ~89% canvas cho vùng QR thật (compact chỉ còn 69% sau khi trừ logo/dải brand),
    // giúp module QR dày hơn ~2 lần khi render xuống kích thước hiển thị.
    url.searchParams.set('template', 'qronly');
    return { ...payment, qrUrl: url.toString() };
  }
  private assertPaymentOwner(
    item: { familyId: string },
    actor?: AuthenticatedUser,
  ) {
    // Những lệnh gọi nội bộ có thể không có actor; tất cả route HTTP đều truyền tài khoản đã qua guard.
    if (
      actor &&
      actor.role !== 'ADMIN' &&
      (actor.role !== 'FAMILY_REP' || actor.familyUnitId !== item.familyId)
    )
      throw new NotFoundException('Không tìm thấy hợp đồng hoặc yêu cầu thanh toán.');
  }
  private async otherActiveContractExists(
    session: PaymentsSession,
    contract: BillingContract,
  ): Promise<boolean> {
    if (contract.addendumId) return false;
    return (await session.listContracts()).some(
      (item) =>
        item.id !== contract.id &&
        item.id !== contract.upgradedFromId &&
        item.familyId === contract.familyId &&
        item.status === BillingContractStatus.ACTIVE,
    );
  }

  private async requireContract(
    session: PaymentsSession,
    id: string,
    addendumId?: string,
  ): Promise<BillingContract> {
    const contract = await session.findContract(id, addendumId);
    if (!contract)
      throw new NotFoundException(
        addendumId
          ? 'Không tìm thấy hợp đồng hoặc phụ lục tương ứng.'
          : 'Không tìm thấy hợp đồng cần thu tiền.',
      );
    return contract;
  }

  private async requireRequest(
    session: PaymentsSession,
    id: string,
  ): Promise<PaymentRequest> {
    const request = await session.findRequest(id);
    if (!request)
      throw new NotFoundException('Không tìm thấy yêu cầu thanh toán.');
    return request;
  }
}
