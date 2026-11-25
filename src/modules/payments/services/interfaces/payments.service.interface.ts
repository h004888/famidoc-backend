import type { AuthenticatedUser } from '../../../../core/auth/authenticated-request';
import type { ListTransactionsDto } from '../../dtos/list-transactions.dto';
import type { AdminPaymentRequestDto } from '../../dtos/create-payment-request.dto';
import type { SePayWebhookDto } from '../../dtos/sepay-webhook.dto';
import type {
  ReconciledPaymentResult,
  SePayApiTransaction,
} from '../../sepay/sepay-api.types';
import type {
  ActivationResult,
  PaymentRequest,
  PaymentRequestStatusView,
  PaymentTransactionResult,
} from '../../entities/payment.entity';
export const PAYMENTS_SERVICE_TOKEN = Symbol('IPaymentsService');
export interface PaymentEligibility {
  eligible: boolean;
  message?: string;
  blockingReasons: string[];
}

export interface FamilyPaymentRequestItem {
  id: string;
  contractId: string;
  contractNumber: string;
  contractStatus: string;
  packageName: string;
  facilityName: string;
  paymentCode: string;
  transferContent: string;
  amountVnd: number;
  grossAmountVnd?: number;
  vatAmountVnd?: number;
  paymentGateway?: string;
  addendumId?: string | null;
  addendumNumber?: string | null;
  addendumType?: string | null;
  contractStartDate?: string | null;
  contractEndDate?: string | null;
  memberCount?: number;
  status: string;
  expectedAccountNumber: string | null;
  expectedGateway: string | null;
  createdAt: string;
  expiresAt: string;
  paidAt: string | null;
  latestTransaction: {
    id: string;
    providerTransactionId: string;
    amountReceived: number;
    paymentTime: string;
    outcome: string;
    reason: string | null;
    referenceCode: string;
    gateway: string;
  } | null;
  openSupportCase: {
    id: string;
    caseCode: string;
    status: string;
    updatedAt: string;
  } | null;
}

export interface IPaymentsService {
  createVietQRPayment(
    contractId: string,
    addendumId?: string,
    actor?: AuthenticatedUser,
  ): Promise<PaymentRequest>;
  createAdminPaymentRequest(dto: AdminPaymentRequestDto, actor: AuthenticatedUser, ip?: string): Promise<PaymentRequest>;
  getAdminPaymentEligibility(contractId: string, addendumId: string | undefined, actor: AuthenticatedUser): Promise<PaymentEligibility>;
  listMyPaymentRequests(actor: AuthenticatedUser): Promise<FamilyPaymentRequestItem[]>;
  getPaymentStatus(
    id: string,
    actor?: AuthenticatedUser,
  ): Promise<PaymentRequestStatusView>;
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
  recheckActivation(
    paymentId: string,
    actor?: AuthenticatedUser,
  ): Promise<ActivationResult>;
}
