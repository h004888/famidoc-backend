import type {
  BillingContract,
  PaymentRequest,
  PaymentTransaction,
} from '../../entities/payment.entity';

// Một session chỉ tồn tại trong một transaction. Adapter Prisma phải dùng cùng tx client.
export interface PaymentsSession {
  nextPaymentNumber(): Promise<number>;
  findContract(
    id: string,
    addendumId?: string,
  ): Promise<BillingContract | null>;
  listContracts(): Promise<
    Pick<BillingContract, 'id' | 'familyId' | 'status'>[]
  >;
  saveContract(contract: BillingContract): Promise<void>;
  findRequest(id: string): Promise<PaymentRequest | null>;
  findRequestByCode(code: string): Promise<PaymentRequest | null>;
  listRequests(
    contractId: string,
    addendumId?: string,
  ): Promise<PaymentRequest[]>;
  saveRequest(request: PaymentRequest): Promise<void>;
  recordPaymentOverride(entry: {
    actorId: string;
    clientIp: string;
    request: PaymentRequest;
    previous: PaymentRequest | null;
    originalAmountVnd: number;
    reason: string;
  }): Promise<void>;
  findTransaction(
    providerId: string,
    environment?: 'TEST' | 'LIVE',
  ): Promise<PaymentTransaction | null>;
  findTransactionByWebhookId(id: string): Promise<PaymentTransaction | null>;
  findTransactionByApiId(id: string): Promise<PaymentTransaction | null>;
  findTransactionByReference(key: string): Promise<PaymentTransaction | null>;
  findTransactionByBankIdentity(
    accountNumber: string,
    referenceCode: string,
  ): Promise<PaymentTransaction | null>;
  findLatestTransactionByRequestId(
    paymentRequestId: string,
  ): Promise<PaymentTransaction | null>;
  listTransactions(): Promise<PaymentTransaction[]>;
  saveTransaction(transaction: PaymentTransaction): Promise<void>;
  linkReconciledTransaction(
    id: string,
    data: {
      sepayWebhookTransactionId?: string;
      sepayApiTransactionId?: string;
      reconciliationRunId?: string;
      reconciledAt?: string;
    },
  ): Promise<PaymentTransaction>;
}

export const PAYMENTS_REPOSITORY_TOKEN = Symbol('IPaymentsRepository');

export interface PaymentsRepository {
  // Tiền, yêu cầu và trạng thái hợp đồng phải cùng commit hoặc cùng rollback.
  transaction<T>(action: (session: PaymentsSession) => Promise<T>): Promise<T>;
}
