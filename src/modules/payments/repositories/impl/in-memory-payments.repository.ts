import { ConflictException, Injectable } from '@nestjs/common';
import type {
  BillingContract,
  PaymentRequest,
  PaymentTransaction,
} from '../../entities/payment.entity';
import {
  PaymentsRepository,
  type PaymentsSession,
} from '../interfaces/payments.repository.interface';

interface MemoryState {
  paymentNumber: number;
  contracts: Map<string, BillingContract>;
  requests: Map<string, PaymentRequest>;
  transactions: Map<string, PaymentTransaction>;
}

// Bản mô phỏng transaction, không phải database bền vững hoặc khóa giữa nhiều server.
@Injectable()
export class InMemoryPaymentsRepository implements PaymentsRepository {
  private state: MemoryState = {
    paymentNumber: 0,
    contracts: new Map(),
    requests: new Map(),
    transactions: new Map(),
  };
  private queue: Promise<void> = Promise.resolve();

  async transaction<T>(
    action: (session: PaymentsSession) => Promise<T>,
  ): Promise<T> {
    // Xếp tuần tự cả đọc/ghi để hai webhook không cùng nhìn thấy một yêu cầu chưa trả tiền.
    let release!: () => void;
    const previous = this.queue;
    this.queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      const working = structuredClone(this.state);
      const result = await action(new MemorySession(working));
      // Sao chép kết quả trước khi commit; lỗi sao chép cũng không được để dữ liệu ghi dở.
      const detachedResult = structuredClone(result);
      // Chỉ công bố trạng thái sau khi toàn bộ nghiệp vụ thành công; lỗi thì bỏ bản sao.
      this.state = working;
      return detachedResult;
    } finally {
      release(); // Luôn mở khóa, kể cả khi callback ném lỗi.
    }
  }
}

class MemorySession implements PaymentsSession {
  constructor(private readonly state: MemoryState) {}

  async nextPaymentNumber(): Promise<number> {
    return ++this.state.paymentNumber;
  }

  async findContract(id: string): Promise<BillingContract | null> {
    return structuredClone(this.state.contracts.get(id) ?? null);
  }

  async listContracts(): Promise<BillingContract[]> {
    return structuredClone([...this.state.contracts.values()]);
  }

  async saveContract(contract: BillingContract): Promise<void> {
    this.state.contracts.set(contract.id, structuredClone(contract));
  }

  async findRequest(id: string): Promise<PaymentRequest | null> {
    return structuredClone(this.state.requests.get(id) ?? null);
  }

  async findRequestByCode(code: string): Promise<PaymentRequest | null> {
    const item = [...this.state.requests.values()].find(
      (request) => request.paymentCode === code,
    );
    return structuredClone(item ?? null);
  }

  async listRequests(contractId: string): Promise<PaymentRequest[]> {
    return structuredClone(
      [...this.state.requests.values()]
        .filter((request) => request.contractId === contractId)
        .sort((a, b) => a.attempt - b.attempt),
    );
  }

  async saveRequest(request: PaymentRequest): Promise<void> {
    if (
      [...this.state.requests.values()].some(
        (item) =>
          item.id !== request.id && item.paymentCode === request.paymentCode,
      )
    ) {
      throw new ConflictException('Payment code already exists');
    }
    this.state.requests.set(request.id, structuredClone(request));
  }

  async findTransaction(
    providerId: string,
  ): Promise<PaymentTransaction | null> {
    const item = [...this.state.transactions.values()].find(
      (transaction) => transaction.providerTransactionId === providerId,
    );
    return structuredClone(item ?? null);
  }

  async findTransactionByWebhookId(
    id: string,
  ): Promise<PaymentTransaction | null> {
    const item = [...this.state.transactions.values()].find(
      (transaction) =>
        transaction.sepayWebhookTransactionId === id ||
        transaction.providerTransactionId === id,
    );
    return structuredClone(item ?? null);
  }

  async findTransactionByApiId(id: string): Promise<PaymentTransaction | null> {
    const item = [...this.state.transactions.values()].find(
      (transaction) => transaction.sepayApiTransactionId === id,
    );
    return structuredClone(item ?? null);
  }

  async findTransactionByReference(
    key: string,
  ): Promise<PaymentTransaction | null> {
    const item = [...this.state.transactions.values()].find(
      (transaction) => transaction.bankReferenceKey === key,
    );
    return structuredClone(item ?? null);
  }

  async findTransactionByBankIdentity(
    accountNumber: string,
    referenceCode: string,
  ): Promise<PaymentTransaction | null> {
    const item = [...this.state.transactions.values()].find(
      (transaction) =>
        transaction.accountNumber === accountNumber &&
        transaction.referenceCode === referenceCode,
    );
    return structuredClone(item ?? null);
  }

  async listTransactions(): Promise<PaymentTransaction[]> {
    return structuredClone([...this.state.transactions.values()]);
  }

  async saveTransaction(transaction: PaymentTransaction): Promise<void> {
    if (
      [...this.state.transactions.values()].some(
        (item) =>
          item.providerTransactionId === transaction.providerTransactionId ||
          (transaction.sepayWebhookTransactionId &&
            item.sepayWebhookTransactionId ===
              transaction.sepayWebhookTransactionId) ||
          (transaction.sepayApiTransactionId &&
            item.sepayApiTransactionId === transaction.sepayApiTransactionId),
      )
    ) {
      throw new ConflictException('Provider transaction already recorded');
    }
    this.state.transactions.set(
      transaction.providerTransactionId,
      structuredClone(transaction),
    );
  }

  async linkReconciledTransaction(
    id: string,
    data: {
      sepayWebhookTransactionId?: string;
      sepayApiTransactionId?: string;
      reconciliationRunId?: string;
      reconciledAt?: string;
    },
  ): Promise<PaymentTransaction> {
    const entry = [...this.state.transactions.entries()].find(
      ([, transaction]) => transaction.id === id,
    );
    if (!entry) throw new ConflictException('Transaction does not exist');
    const [key, transaction] = entry;
    const updated = { ...transaction, ...data };
    this.state.transactions.set(key, structuredClone(updated));
    return structuredClone(updated);
  }
}
