import type { IPaymentsService } from '../interfaces/payments.service.interface';
import type { AuthenticatedUser } from '../../../../core/auth/authenticated-request';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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

@Injectable()
export class PaymentsServiceImpl implements IPaymentsService {
  // Các dependency được NestJS cấp; không tạo kết nối DB/SePay bên trong service.
  constructor(
    @Inject(PAYMENTS_REPOSITORY_TOKEN)
    private readonly repository: PaymentsRepository,
    private readonly config: PaymentsConfig,
    private readonly clock: PaymentsClock,
  ) {}

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

  private issuePayment(
    contractId: string,
    addendumId: string | undefined,
    actor: AuthenticatedUser | undefined,
    adjustment?: { dto: AdminPaymentRequestDto; actorId: string; ip?: string },
  ): Promise<PaymentRequest> {
    const destination = this.config.getDestination();
    return this.repository.transaction(async (session) => {
      const contract = await this.requireContract(
        session,
        contractId,
        addendumId,
      );
      this.assertPaymentOwner(contract, actor);
      this.config.assertContractEnvironment(contract.simulation);
      if (contract.status !== BillingContractStatus.PENDING)
        throw new ConflictException('Contract is not pending');
      // Chỉ phát hành yêu cầu khi bốn bên, phân công và năng lực phục vụ đã đủ điều kiện.
      const missing = missingActivationRequirements(contract.requirements);
      if (missing.length)
        throw new ConflictException({
          message: 'Contract is not ready for payment',
          blockingReasons: missing,
        });
      if (await this.otherActiveContractExists(session, contract))
        throw new ConflictException('Family already has an active contract');
      const requests = await session.listRequests(contractId, addendumId);
      if (requests.some((item) => item.status === PaymentRequestStatus.PAID)) {
        throw new ConflictException(
          'Contract payment has already been recorded',
        );
      }
      const now = this.clock.now();
      const pending = requests.find(
        (item) =>
          item.status === PaymentRequestStatus.PENDING &&
          Date.parse(item.expiresAt) > now.getTime(),
      );
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
        throw new BadRequestException('Invalid contract payment amount');
      const paymentCode = createPaymentCode(await session.nextPaymentNumber());
      const payment: PaymentRequest = {
        id: randomUUID(),
        contractId,
        familyId: contract.familyId,
        environment: this.config.getEnvironment(),
        addendumId,
        attempt: (requests.at(-1)?.attempt ?? 0) + 1,
        paymentCode,
        transferContent: description ? `${description} ${paymentCode}` :
          buildTransferContent(contract.payerDisplayName, paymentCode),
        adminTransferDescription: description,
        amountVnd: amount,
        currency: 'VND',
        expectedAccountNumber: destination.accountNumber,
        expectedGateway: destination.gateway,
        status: PaymentRequestStatus.PENDING,
        createdAt: now.toISOString(),
        expiresAt: new Date(
          now.getTime() + destination.ttlMinutes * 60_000,
        ).toISOString(),
        paidAt: null,
        acceptedTransactionId: null,
      };
      await session.saveRequest(payment);
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
          } else {
            view.activation = {
              activated: false,
              blockingReasons: (
                await this.evaluateActivation(session, contract)
              ).blockingReasons,
            };
          }
        }
      } else if (item.status === PaymentRequestStatus.PENDING) {
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
        throw new ConflictException('A paid request cannot be cancelled');
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
      const items = (await session.listTransactions()).filter(
        (item) => !query.outcome || item.outcome === query.outcome,
      );
      return {
        items: items.slice(
          (query.page - 1) * query.limit,
          query.page * query.limit,
        ),
        total: items.length,
        page: query.page,
        limit: query.limit,
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
    const amount =
      item.transfer_type === 'in' ? item.amount_in : item.amount_out;
    if (!Number.isSafeInteger(amount) || amount <= 0)
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
      referenceCode: item.reference_number,
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
        rawContent: incoming.content,
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
      payment.paidAt = record.transactionAt;
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
      const activation = await this.activateInTransaction(session, contract);
      console.log('[DEBUG_CP11][WEBHOOK_CONTRACT_ACTIVATION_RESULT]', {
        contractId: activation.contractId,
        status: activation.status,
        activated: activation.activated,
        blockingReasons: activation.blockingReasons,
      });
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
          throw new ForbiddenException(
            'Only the payment owner family or an admin can recheck activation',
          );
        if (payment.status !== PaymentRequestStatus.PAID)
          throw new ForbiddenException(
            'Activation can only be rechecked after the payment is recorded',
          );
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
    // Ngân hàng trả thời gian chính xác đến giây; không so trực tiếp với mili giây lúc tạo.
    if (bankTime < Math.floor(Date.parse(payment.createdAt) / 1000) * 1000)
      return TransactionReason.BEFORE_REQUEST;
    if (bankTime > this.clock.now().getTime() + 300_000)
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
    const attempts = await session.listRequests(
      payment.contractId,
      payment.addendumId,
    );
    if (attempts.at(-1)?.id !== payment.id)
      return TransactionReason.SUPERSEDED_REQUEST;
    if (bankTime >= Date.parse(payment.expiresAt))
      return TransactionReason.LATE_PAYMENT;
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
    contract.status = BillingContractStatus.ACTIVE;
    contract.activeFrom = contract.plannedFrom ?? now.toISOString();
    contract.activeUntil =
      contract.plannedUntil ??
      addContractMonths(
        now,
        contract.packageSnapshot.package.durationMonths,
      ).toISOString();
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
    // qr_only giữ ~89% canvas cho vùng QR thật (compact chỉ còn 69% sau khi trừ logo/dải brand),
    // giúp module QR dày hơn ~2 lần khi render xuống kích thước hiển thị.
    url.searchParams.set('template', 'qr_only');
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
      throw new NotFoundException('Payment or contract not found');
  }
  private async otherActiveContractExists(
    session: PaymentsSession,
    contract: BillingContract,
  ): Promise<boolean> {
    if (contract.addendumId) return false;
    return (await session.listContracts()).some(
      (item) =>
        item.id !== contract.id &&
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
    if (!contract) throw new NotFoundException('Billing contract not found');
    return contract;
  }

  private async requireRequest(
    session: PaymentsSession,
    id: string,
  ): Promise<PaymentRequest> {
    const request = await session.findRequest(id);
    if (!request) throw new NotFoundException('Payment request not found');
    return request;
  }
}
