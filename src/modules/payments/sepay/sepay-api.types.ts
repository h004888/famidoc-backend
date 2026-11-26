export type PaymentEnvironment = 'TEST' | 'LIVE';

export interface SePayApiTransaction {
  id: string;
  transaction_date: string;
  account_number: string;
  amount_in: number;
  amount_out: number;
  accumulated: number;
  transaction_content: string;
  reference_number: string;
  code: string | null;
  bank_brand_name: string;
  bank_account_id: string;
  va_id: string | null;
  webhook_success: 0 | 1 | null;
  transfer_type: 'in' | 'out';
}

export interface SePayTransactionPage {
  transactions: SePayApiTransaction[];
  currentPage: number;
  hasMore: boolean;
}

export interface SePayTransactionQuery {
  bankAccountId: string;
  page: number;
  perPage: number;
  sinceId?: string;
  from?: Date;
  to?: Date;
}

export interface ReconciledPaymentResult {
  testOnly?: boolean;
  duplicate: boolean;
  linked: boolean;
  transaction: import('../entities/payment.entity').PaymentTransaction;
}
