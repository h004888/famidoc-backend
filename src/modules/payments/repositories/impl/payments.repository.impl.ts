import { calculateContractTermsHash } from '../../../contracts/pricing/contract-terms-hash';
import { activateAddendumRights } from '../../../contracts/activation/activate-addendum';
import { PaymentsConfig } from '../../payments.config';
import { todayInVietnam } from '../../../../core/business/business-helpers';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  type Invoice,
  type PaymentTransaction as TransactionRow,
} from '@prisma/client';
import { PrismaService } from '../../../../core/database/prisma.service';
import {
  serializable,
  moneyToNumber,
} from '../../../../core/database/prisma-transaction';
import {
  BillingContractStatus,
  PaymentRequestStatus,
  TransactionOutcome,
  type TransactionReason,
  type BillingContract,
  type PaymentRequest,
  type PaymentTransaction,
} from '../../entities/payment.entity';
import type {
  PaymentsRepository,
  PaymentsSession,
} from '../interfaces/payments.repository.interface';

const contractInclude = Prisma.validator<Prisma.MedicalContractInclude>()({
  signatures: {
    where: { addendumId: null },
    include: { signerUser: { select: { role: true, status: true } } },
  },
  familyUnit: {
    include: { representativeUser: { select: { fullName: true } } },
  },
  facility: { include: { user: true } },
  doctor: { include: { user: true } },
});
type ContractRow = Prisma.MedicalContractGetPayload<{
  include: typeof contractInclude;
}>;

function requestEntity(
  row: Invoice & { contract: { familyId: string } | null },
): PaymentRequest {
  if (
    !row.contractId ||
    !row.contract ||
    !row.expectedAccountNumber ||
    !row.expectedGateway
  ) {
    throw new ConflictException('Invoice is not a supported contract payment');
  }
  return {
    id: row.id,
    contractId: row.contractId,
    familyId: row.contract.familyId,
    addendumId: row.addendumId ?? undefined,
    environment: row.environment as 'TEST' | 'LIVE',
    attempt: row.attempt,
    paymentCode: row.invoiceCode,
    transferContent: row.transferContent ?? row.invoiceCode,
    amountVnd: moneyToNumber(row.totalPayable),
    currency: 'VND',
    expectedAccountNumber: row.expectedAccountNumber,
    expectedGateway: row.expectedGateway,
    status: row.paymentStatus as PaymentRequestStatus,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiredAt.toISOString(),
    paidAt: row.paidAt?.toISOString() ?? null,
    acceptedTransactionId: row.acceptedTransactionId,
  };
}
function transactionEntity(row: TransactionRow): PaymentTransaction {
  return {
    id: row.id,
    environment: row.environment as 'TEST' | 'LIVE',
    providerTransactionId: row.gatewayTransactionId,
    fingerprint: row.fingerprint,
    bankReferenceKey: row.bankReferenceKey,
    gateway: row.gateway,
    accountNumber: row.accountNumber,
    transferType: row.transferType as 'in' | 'out',
    amountVnd: moneyToNumber(row.amountReceived),
    paymentCode: row.paymentCode,
    paymentRequestId: row.invoiceId,
    referenceCode: row.referenceCode,
    transactionAt: row.paymentTime.toISOString(),
    receivedAt: row.createdAt.toISOString(),
    outcome: row.outcome as TransactionOutcome,
    reason: row.reason as TransactionReason | null,
  };
}
@Injectable()
export class PaymentsRepositoryImpl implements PaymentsRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: PaymentsConfig,
  ) {}
  transaction<T>(action: (session: PaymentsSession) => Promise<T>): Promise<T> {
    // Không gọi dịch vụ ngoài: ghi sổ, đối soát và kích hoạt cùng một transaction DB.
    return serializable(this.prisma, (tx) =>
      action(new PrismaPaymentsSession(tx, this.config.getEnvironment())),
    );
  }
}
class PrismaPaymentsSession implements PaymentsSession {
  constructor(
    private readonly tx: Prisma.TransactionClient,
    private readonly environment: 'TEST' | 'LIVE',
  ) {}
  async nextPaymentNumber(): Promise<number> {
    // nextval cấp số chung cho mọi kết nối. Transaction bị hủy có thể bỏ qua số, nhưng không dùng lại.
    const [row] = await this.tx.$queryRaw<{ number: bigint }[]>`
      SELECT nextval('payment_code_number_seq') AS number`;
    return Number(row.number);
  }
  private async contractEntity(row: ContractRow): Promise<BillingContract> {
    if (!row.billingSnapshot)
      throw new ConflictException(
        'Signed billing terms have not been recorded',
      );
    if (row.isDemo !== (this.environment === 'TEST'))
      throw new ConflictException('Contract/payment environment mismatch');
    const signature = (role: string, userId?: string) =>
      row.signatures.some(
        (s) =>
          s.signerRole === role &&
          (!userId || s.signerUserId === userId) &&
          s.signerUser.status === 'ACTIVE' &&
          (role !== 'ADMIN' || s.signerUser.role === 'ADMIN') &&
          s.signatureHash.length > 0 &&
          (!row.upgradedFromId ||
            s.termsHash === calculateContractTermsHash(row)),
      );
    const activeCount = await this.tx.medicalContract.count({
      where: {
        doctorId: row.doctorId,
        contractStatus: 'ACTIVE',
        id: { not: row.id },
      },
    });
    const now = todayInVietnam();
    const staffing = await this.tx.b2bStaffingContract.findFirst({
      where: {
        facilityId: row.facilityId,
        status: 'ACTIVE',
        startDate: { lte: now },
        endDate: { gt: now },
      },
      select: { id: true },
    });
    const snapshot =
      row.billingSnapshot as unknown as BillingContract['packageSnapshot'];
    if (
      snapshot.package.id !== row.packageId ||
      snapshot.pricing.totalPriceVnd !== moneyToNumber(row.totalAmount)
    ) {
      throw new ConflictException(
        'Contract snapshot does not match signed amount/package',
      );
    }
    return {
      id: row.id,
      familyId: row.familyId,
      payerDisplayName: row.familyUnit.representativeUser.fullName,
      simulation: row.isDemo,
      status:
        row.contractStatus === 'ACTIVE'
          ? BillingContractStatus.ACTIVE
          : ['EXPIRED', 'TERMINATED'].includes(row.contractStatus)
            ? BillingContractStatus.CANCELLED
            : BillingContractStatus.PENDING,
      packageSnapshot: snapshot,
      // Đọc chữ ký, phân công và sức chứa từ DB; không nhận cờ tự khai từ client.
      requirements: {
        familySigned: signature(
          'FAMILY_REP',
          row.familyUnit.representativeUserId,
        ),
        adminSigned: signature('ADMIN'),
        facilitySigned: signature('HEALTHCARE_FACILITY', row.facility.userId),
        doctorSigned: signature('ASSIGNED_DOCTOR', row.doctor.userId),
        facilityId: row.facilityId,
        doctorId: row.doctorId,
        doctorVerified:
          row.doctor.onboardingStatus === 'ACTIVE' &&
          row.doctor.user.status === 'ACTIVE' &&
          row.facility.verificationStatus === 'ACTIVE' &&
          row.facility.user.status === 'ACTIVE' &&
          row.familyUnit.status === 'ACTIVE' &&
          row.doctor.facilityId === row.facilityId &&
          !!staffing,
        panelCapacityAvailable: activeCount < row.doctor.maxPanelCapacity,
        familyCoverageComplete:
          (await this.tx.patient.count({
            where: { familyId: row.familyId, status: 'ACTIVE' },
          })) <= row.memberCount,
        contractTermValid:
          row.startDate <= todayInVietnam() && row.endDate > todayInVietnam(),
      },
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      activeFrom:
        row.contractStatus === 'ACTIVE' ? row.startDate.toISOString() : null,
      activeUntil:
        row.contractStatus === 'ACTIVE' ? row.endDate.toISOString() : null,
      plannedFrom: row.startDate.toISOString(),
      plannedUntil: row.endDate.toISOString(),
    };
  }
  async findContract(id: string, addendumId?: string) {
    await this.tx
      .$queryRaw`SELECT id FROM medical_contracts WHERE id=${id}::uuid FOR UPDATE`;
    const row = await this.tx.medicalContract.findUnique({
      where: { id },
      include: contractInclude,
    });
    if (!row) return null;
    const contract = await this.contractEntity(row);
    if (!addendumId) return contract;
    const item = await this.tx.contractAddendum.findUnique({
      where: { id: addendumId },
      include: {
        signatures: {
          include: { signerUser: { select: { status: true, role: true } } },
        },
      },
    });
    if (!item || item.contractId !== id) return null;
    const roles = {
      FAMILY_REP: row.familyUnit.representativeUserId,
      HEALTHCARE_FACILITY: row.facility.userId,
      ASSIGNED_DOCTOR: row.doctor.userId,
    };
    const signed = (
      role: 'FAMILY_REP' | 'ADMIN' | 'HEALTHCARE_FACILITY' | 'ASSIGNED_DOCTOR',
    ) =>
      item.signatures.some(
        (s) =>
          s.signerRole === role &&
          s.termsHash === item.termsHash &&
          s.signerUser.status === 'ACTIVE' &&
          (role === 'ADMIN'
            ? s.signerUser.role === 'ADMIN'
            : s.signerUserId === roles[role]),
      );
    const drafted = item.termsSnapshot as {
      familyId?: string;
      facilityId?: string;
      doctorId?: string;
      additionalMembers?: number;
      memberIds?: string[];
    };
    if (
      drafted.familyId !== row.familyId ||
      drafted.facilityId !== row.facilityId ||
      drafted.doctorId !== row.doctorId
    )
      contract.requirements.doctorVerified = false;
    contract.addendumId = item.id;
    contract.status =
      row.contractStatus !== 'ACTIVE' || item.status === 'CANCELLED'
        ? BillingContractStatus.CANCELLED
        : item.status === 'ACTIVE'
          ? BillingContractStatus.ACTIVE
          : BillingContractStatus.PENDING;
    contract.packageSnapshot = structuredClone(contract.packageSnapshot);
    contract.packageSnapshot.pricing.totalPriceVnd = moneyToNumber(
      item.additionalAmount,
    );
    contract.requirements = {
      ...contract.requirements,
      // Khi mua bổ sung, xét số người sau phụ lục; không chặn việc mua thêm vì gói hiện tại đang thiếu chỗ.
      familyCoverageComplete:
        (await this.tx.patient.count({
          where: { familyId: row.familyId, status: 'ACTIVE' },
        })) <=
        row.memberCount +
          (item.addendumType === 'MEMBER_EXTENSION'
            ? (drafted.additionalMembers ?? drafted.memberIds?.length ?? 0)
            : 0),
      familySigned: signed('FAMILY_REP'),
      adminSigned: signed('ADMIN'),
      facilitySigned: signed('HEALTHCARE_FACILITY'),
      doctorSigned: signed('ASSIGNED_DOCTOR'),
    };
    return contract;
  }
  async listContracts() {
    const rows = await this.tx.medicalContract.findMany({
      where: { contractStatus: 'ACTIVE' },
      select: { id: true, familyId: true },
    });
    // Service chỉ dùng ID, familyId và trạng thái để kiểm tra hợp đồng khác đang hoạt động.
    return rows.map((row) => ({
      ...row,
      status: BillingContractStatus.ACTIVE,
    }));
  }
  async saveContract(contract: BillingContract): Promise<void> {
    const old = await this.tx.medicalContract.findUnique({
      where: { id: contract.id },
      include: contractInclude,
    });
    if (!old)
      throw new NotFoundException(
        'Create contracts through the signing workflow, not the payment API',
      );
    if (old.isDemo !== (this.environment === 'TEST'))
      throw new ConflictException('Contract/payment environment mismatch');
    if (contract.addendumId) {
      await activateAddendumRights(this.tx, old.id, contract.addendumId);
      return;
    }
    if (
      contract.status === BillingContractStatus.ACTIVE &&
      old.contractStatus !== 'ACTIVE'
    ) {
      // Khóa bác sĩ để hai gia đình kích hoạt đồng thời không vượt panel cap.
      // Serializable sẽ retry nếu snapshot cũ xung đột với lần cập nhật trước.
      await this.tx
        .$queryRaw`SELECT id FROM doctors WHERE id = ${old.doctorId}::uuid FOR UPDATE`;
      const fresh = await this.contractEntity(old);
      if (
        Object.values(fresh.requirements).some((v) => v === false || v === null)
      )
        throw new ConflictException('Activation requirements changed');
      if (old.endDate <= new Date())
        throw new ConflictException('Signed contract term has expired');
      await this.tx.doctor.update({
        where: { id: old.doctorId },
        data: {
          activePanelCount:
            1 +
            (await this.tx.medicalContract.count({
              where: { doctorId: old.doctorId, contractStatus: 'ACTIVE' },
            })),
        },
      });
    }
    await this.tx.medicalContract.update({
      where: { id: contract.id },
      data: {
        contractStatus:
          contract.status === BillingContractStatus.ACTIVE
            ? 'ACTIVE'
            : contract.status === BillingContractStatus.CANCELLED
              ? 'TERMINATED'
              : 'PENDING_PAYMENT',
        updatedAt: new Date(contract.updatedAt),
        // Không sửa giá, chữ ký hay kỳ hạn đã thỏa thuận khi nhận tiền.
      },
    });
  }
  async findRequest(id: string) {
    const row = await this.tx.invoice.findUnique({
      where: { id },
      include: { contract: { select: { familyId: true } } },
    });
    return row && row.environment === this.environment
      ? requestEntity(row)
      : null;
  }
  async findRequestByCode(invoiceCode: string) {
    const row = await this.tx.invoice.findUnique({
      where: { invoiceCode },
      include: { contract: { select: { familyId: true } } },
    });
    return row && row.environment === this.environment
      ? requestEntity(row)
      : null;
  }
  async listRequests(contractId: string, addendumId?: string) {
    return (
      await this.tx.invoice.findMany({
        where: {
          contractId,
          addendumId: addendumId ?? null,
          encounterId: null,
          environment: this.environment,
        },
        orderBy: { attempt: 'asc' },
        include: { contract: { select: { familyId: true } } },
      })
    ).map(requestEntity);
  }
  async saveRequest(item: PaymentRequest): Promise<void> {
    await this.tx.invoice.upsert({
      where: { id: item.id },
      create: {
        id: item.id,
        contractId: item.contractId,
        addendumId: item.addendumId,
        environment: item.environment,
        invoiceCode: item.paymentCode,
        transferContent: item.transferContent ?? item.paymentCode,
        attempt: item.attempt,
        grossAmount: item.amountVnd,
        vatAmount: 0,
        totalPayable: item.amountVnd,
        paymentGateway: item.environment === 'TEST' ? 'VIETQR_TEST' : 'VIETQR',
        expectedAccountNumber: item.expectedAccountNumber,
        expectedGateway: item.expectedGateway,
        paymentStatus: item.status,
        createdAt: item.createdAt,
        expiredAt: item.expiresAt,
        paidAt: item.paidAt,
        acceptedTransactionId: item.acceptedTransactionId,
      },
      update: {
        paymentStatus: item.status,
        paidAt: item.paidAt,
        acceptedTransactionId: item.acceptedTransactionId,
      },
    });
  }
  async findTransaction(
    gatewayTransactionId: string,
    environment: 'TEST' | 'LIVE' = this.environment,
  ) {
    const row = await this.tx.paymentTransaction.findUnique({
      where: {
        environment_gatewayTransactionId: { environment, gatewayTransactionId },
      },
    });
    return row ? transactionEntity(row) : null;
  }
  async findTransactionByReference(bankReferenceKey: string) {
    const row = await this.tx.paymentTransaction.findFirst({
      where: { bankReferenceKey, environment: this.environment },
      orderBy: { createdAt: 'asc' },
    });
    return row ? transactionEntity(row) : null;
  }
  async listTransactions() {
    return (
      await this.tx.paymentTransaction.findMany({
        where: { environment: this.environment },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      })
    ).map(transactionEntity);
  }
  async saveTransaction(item: PaymentTransaction): Promise<void> {
    // Sổ giao dịch chỉ thêm mới. Payload gốc phục vụ kiểm toán, không trả cho gia đình.
    await this.tx.paymentTransaction.create({
      data: {
        id: item.id,
        invoiceId: item.paymentRequestId,
        gatewayTransactionId: item.providerTransactionId,
        amountReceived: item.amountVnd,
        paymentTime: item.transactionAt,
        signatureVerified: true,
        webhookPayload: (item.rawPayload ?? {}) as Prisma.InputJsonValue,
        createdAt: item.receivedAt,
        environment: item.environment,
        fingerprint: item.fingerprint,
        bankReferenceKey: item.bankReferenceKey,
        gateway: item.gateway,
        accountNumber: item.accountNumber,
        transferType: item.transferType,
        paymentCode: item.paymentCode,
        referenceCode: item.referenceCode,
        outcome: item.outcome,
        reason: item.reason,
      },
    });
  }
}
