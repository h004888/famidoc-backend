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
  findTransaction(
    providerId: string,
    environment?: 'TEST' | 'LIVE',
  ): Promise<PaymentTransaction | null>;
  findTransactionByReference(key: string): Promise<PaymentTransaction | null>;
  listTransactions(): Promise<PaymentTransaction[]>;
  saveTransaction(transaction: PaymentTransaction): Promise<void>;
}

export const PAYMENTS_REPOSITORY_TOKEN = Symbol('IPaymentsRepository');

export interface PaymentsRepository {
  // Tiền, yêu cầu và trạng thái hợp đồng phải cùng commit hoặc cùng rollback.
  transaction<T>(action: (session: PaymentsSession) => Promise<T>): Promise<T>;
}
