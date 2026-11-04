import type { CarePackageQuote } from '../../care-packages/entities/care-package-quote.entity';

export enum BillingContractStatus {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  CANCELLED = 'CANCELLED',
}

export interface ActivationRequirements {
  familySigned: boolean;
  adminSigned: boolean;
  facilitySigned: boolean;
  doctorSigned: boolean;
  facilityId: string | null;
  doctorId: string | null;
  doctorVerified: boolean;
  panelCapacityAvailable: boolean;
  contractTermValid?: boolean;
  familyCoverageComplete?: boolean; // Không kích hoạt gói thiếu số người so với gia đình.
}

// Thông tin hợp đồng/phụ lục cần để thu tiền. Dữ liệu gốc nằm trong MedicalContract và ContractAddendum.
export interface BillingContract {
  id: string;
  familyId: string;
  payerDisplayName?: string; // Tên người đại diện gia đình, lấy từ DB chứ không lấy từ body thanh toán.
  simulation: boolean; // Tương ứng isDemo trong DB, dùng để tách TEST và LIVE.
  status: BillingContractStatus;
  // Chụp lại giá/quyền lợi lúc tạo dữ liệu hợp đồng; không đọc giá gói hiện hành khi thu tiền.
  packageSnapshot: Pick<
    CarePackageQuote,
    'package' | 'members' | 'pricing' | 'benefits'
  >;
  requirements: ActivationRequirements;
  createdAt: string;
  updatedAt: string;
  activeFrom: string | null;
  activeUntil: string | null;
  addendumId?: string;
  plannedFrom?: string;
  plannedUntil?: string;
}

export enum PaymentRequestStatus {
  PENDING = 'PENDING',
  PAID = 'PAID',
  EXPIRED = 'EXPIRED',
  CANCELLED = 'CANCELLED',
}

export interface PaymentRequest {
  id: string;
  contractId: string;
  familyId: string;
  addendumId?: string;
  environment: 'TEST' | 'LIVE';
  attempt: number; // Tăng mỗi lần cấp mã mới; không tái sử dụng mã hết hạn.
  paymentCode: string;
  transferContent?: string; // Nội dung QR đã chốt: tên tài khoản không dấu + mã thanh toán riêng.
  amountVnd: number;
  currency: 'VND';
  qrUrl?: string | null;
  expectedAccountNumber: string;
  expectedGateway: string;
  status: PaymentRequestStatus;
  createdAt: string;
  expiresAt: string;
  paidAt: string | null;
  acceptedTransactionId: string | null;
}

export enum TransactionOutcome {
  MATCHED = 'MATCHED', // Tiền hợp lệ; kích hoạt còn phải qua bước kiểm tra riêng.
  IGNORED = 'IGNORED',
  REVIEW_REQUIRED = 'REVIEW_REQUIRED',
}

export enum TransactionReason {
  OUTGOING_TRANSFER = 'OUTGOING_TRANSFER',
  WRONG_ACCOUNT = 'WRONG_ACCOUNT',
  MISSING_CODE = 'MISSING_CODE',
  AMBIGUOUS_CODE = 'AMBIGUOUS_CODE',
  UNKNOWN_CODE = 'UNKNOWN_CODE',
  AMOUNT_MISMATCH = 'AMOUNT_MISMATCH',
  BEFORE_REQUEST = 'BEFORE_REQUEST',
  FUTURE_TRANSACTION = 'FUTURE_TRANSACTION',
  LATE_PAYMENT = 'LATE_PAYMENT',
  SUPERSEDED_REQUEST = 'SUPERSEDED_REQUEST',
  CANCELLED_REQUEST = 'CANCELLED_REQUEST',
  CONTRACT_UNAVAILABLE = 'CONTRACT_UNAVAILABLE',
  ALREADY_PAID = 'ALREADY_PAID',
  DUPLICATE_BANK_REFERENCE = 'DUPLICATE_BANK_REFERENCE',
}

export interface PaymentTransaction {
  id: string;
  environment: 'TEST' | 'LIVE';
  providerTransactionId: string; // ID SePay dùng chống trùng, độc lập ID của backend.
  fingerprint: string; // Phát hiện cùng ID nhưng dữ liệu giao dịch bị thay đổi.
  bankReferenceKey: string | null;
  gateway: string;
  accountNumber: string;
  transferType: 'in' | 'out';
  amountVnd: number;
  paymentCode: string | null;
  paymentRequestId: string | null;
  referenceCode: string;
  transactionAt: string;
  receivedAt: string;
  outcome: TransactionOutcome;
  reason: TransactionReason | null;
  rawPayload?: Record<string, unknown>;
}

export interface ActivationResult {
  contractId: string;
  status: BillingContractStatus;
  activated: boolean;
  blockingReasons: string[];
}

export interface PaymentTransactionResult {
  duplicate: boolean;
  transaction: PaymentTransaction;
  activation: ActivationResult | null;
}
