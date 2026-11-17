import type { AuthenticatedUser } from '../../../../core/auth/authenticated-request';
import type { ListTransactionsDto } from '../../dtos/list-transactions.dto';
import type { SePayWebhookDto } from '../../dtos/sepay-webhook.dto';
import type {
  ReconciledPaymentResult,
  SePayApiTransaction,
} from '../../sepay/sepay-api.types';
import type {
  ActivationResult,
  PaymentRequest,
  PaymentTransactionResult,
} from '../../entities/payment.entity';
export const PAYMENTS_SERVICE_TOKEN = Symbol('IPaymentsService');
export interface IPaymentsService {
  createVietQRPayment(
    contractId: string,
    addendumId?: string,
    actor?: AuthenticatedUser,
  ): Promise<PaymentRequest>;
  getPaymentStatus(
    id: string,
    actor?: AuthenticatedUser,
  ): Promise<PaymentRequest>;
  cancelRequest(id: string, actor?: AuthenticatedUser): Promise<PaymentRequest>;
  listTransactions(query: ListTransactionsDto): Promise<unknown>;
  handleVietQRWebhook(dto: SePayWebhookDto): Promise<PaymentTransactionResult>;
  handleSePayApiTransaction(
    transaction: SePayApiTransaction,
    reconciliationRunId: string,
  ): Promise<ReconciledPaymentResult>;
  tryActivate(
    contractId: string,
    addendumId?: string,
  ): Promise<ActivationResult>;
}
