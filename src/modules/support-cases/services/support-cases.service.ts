import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  Prisma,
  type SupportCaseStatus,
  type SupportCaseType,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { AuthenticatedUser } from '../../../core/auth/authenticated-request';
import { writeBusinessAudit } from '../../../core/business/business-helpers';
import { PrismaService } from '../../../core/database/prisma.service';
import {
  moneyToNumber,
  serializable,
} from '../../../core/database/prisma-transaction';
import { StorageService } from '../../../core/services/storage.service';
import { validateUploadedDocumentFile } from '../../../core/validation/document-file.validator';
import type {
  CreateComplaintSupportCaseDto,
  CreatePaymentIssueCaseDto,
  ListSupportCasesQueryDto,
  PostSupportMessageDto,
  UpdateSupportCaseStatusDto,
} from '../dtos/support-case.dto';

const OPEN_CASE_STATUSES: SupportCaseStatus[] = [
  'OPEN',
  'IN_REVIEW',
  'NEED_MORE_INFO',
];
const APPEAL_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CONSECUTIVE_FAMILY_MESSAGES = 2;
const SUPPORT_ATTACHMENT_OPTIONS = {
  maxBytes: 5 * 1024 * 1024,
  label: 'Tệp đính kèm',
};

const CASE_DETAIL_INCLUDE = Prisma.validator<Prisma.SupportCaseInclude>()({
  familyUser: { select: { id: true, fullName: true, phone: true } },
  resolver: { select: { id: true, fullName: true } },
  contract: {
    select: {
      id: true,
      contractNumber: true,
      contractStatus: true,
      facility: { select: { facilityName: true } },
      doctor: { select: { doctorName: true } },
      servicePackage: { select: { packageName: true } },
    },
  },
  complaint: {
    select: {
      id: true,
      complaintCode: true,
      complaintCategory: true,
      description: true,
      evidenceAttachments: true,
      facilityResponse: true,
      facilityReviewedAt: true,
      resolutionOutcome: true,
      resolutionNotes: true,
      status: true,
      resolvedAt: true,
      createdAt: true,
    },
  },
  invoice: {
    select: {
      id: true,
      invoiceCode: true,
      transferContent: true,
      totalPayable: true,
      paymentStatus: true,
      expectedAccountNumber: true,
      expectedGateway: true,
      environment: true,
      expiredAt: true,
      paidAt: true,
      createdAt: true,
    },
  },
  transaction: { select: { environment: true } },
  messages: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    include: {
      senderUser: { select: { id: true, fullName: true, role: true } },
    },
  },
});

type CaseDetailRow = Prisma.SupportCaseGetPayload<{
  include: typeof CASE_DETAIL_INCLUDE;
}>;

const CASE_LIST_INCLUDE = Prisma.validator<Prisma.SupportCaseInclude>()({
  familyUser: { select: { id: true, fullName: true, phone: true } },
  contract: {
    select: {
      id: true,
      contractNumber: true,
      contractStatus: true,
      facility: { select: { facilityName: true } },
      servicePackage: { select: { packageName: true } },
    },
  },
  complaint: {
    select: {
      id: true,
      complaintCode: true,
      complaintCategory: true,
      status: true,
      resolutionOutcome: true,
    },
  },
  invoice: {
    select: {
      id: true,
      invoiceCode: true,
      totalPayable: true,
      paymentStatus: true,
      environment: true,
      addendumId: true,
      paidAt: true,
    },
  },
  transaction: { select: { environment: true } },
  messages: {
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: {
      id: true,
      senderRole: true,
      body: true,
      createdAt: true,
    },
  },
  _count: {
    select: { messages: true },
  },
});

type CaseListRow = Prisma.SupportCaseGetPayload<{
  include: typeof CASE_LIST_INCLUDE;
}>;

function buildCaseCode(caseType: SupportCaseType): string {
  const prefix =
    caseType === 'PAYMENT_ISSUE'
      ? 'CK'
      : caseType === 'COMPLAINT_APPEAL'
        ? 'XL'
        : 'CH';
  return `${prefix}-${randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase()}`;
}

function notificationTypeForCase(caseType: SupportCaseType): string {
  return caseType === 'PAYMENT_ISSUE'
    ? 'SUPPORT_CASE_PAYMENT'
    : 'SUPPORT_CASE_COMPLAINT';
}

function statusTitleForFamily(status: SupportCaseStatus): string {
  switch (status) {
    case 'IN_REVIEW':
      return 'Hồ sơ hỗ trợ đang được Admin xử lý';
    case 'NEED_MORE_INFO':
      return 'Admin cần gia đình bổ sung thông tin';
    case 'RESOLVED':
      return 'Hồ sơ hỗ trợ đã có kết quả';
    case 'CLOSED':
      return 'Hồ sơ hỗ trợ đã được đóng';
    default:
      return 'Cập nhật hồ sơ hỗ trợ';
  }
}

function parseAttachmentKeys(value: Prisma.JsonValue | null): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function extractTransferContentFromPayload(
  payload: Prisma.JsonValue,
): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }
  const record = payload as Record<string, unknown>;
  const raw = record.content ?? record.transaction_content;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

function remainingFamilyReplies(
  messages: Array<{ senderRole: string; isSupplement?: boolean }>,
): number {
  let remaining = MAX_CONSECUTIVE_FAMILY_MESSAGES;
  for (let i = messages.length - 1; i >= 0 && remaining > 0; i -= 1) {
    const message = messages[i];
    if (message.senderRole !== 'FAMILY_REP') break;
    // Mỗi yêu cầu bổ sung chỉ nhận một lượt cho tới khi Admin phản hồi.
    if (message.isSupplement) return 0;
    remaining -= 1;
  }
  return remaining;
}

function findRelatedPaymentTransactions(invoice: {
  id: string;
  invoiceCode: string;
  environment: string;
}): Prisma.PaymentTransactionWhereInput {
  return {
    environment: invoice.environment,
    OR: [
      { invoiceId: invoice.id },
      { invoiceId: null, paymentCode: invoice.invoiceCode },
    ],
  };
}

function casePaymentContext(row: CaseListRow | CaseDetailRow) {
  const snapshot = row.contextSnapshot;
  const matchesEnvironment =
    row.transaction && row.transaction.environment === row.invoice?.environment;
  if (row.caseType !== 'PAYMENT_ISSUE' || matchesEnvironment) {
    return { transactionId: row.transactionId, contextSnapshot: snapshot };
  }

  // Bản chụp cũ có thể đã giữ một giao dịch khác môi trường với hóa đơn.
  const contextSnapshot = snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)
    ? { ...snapshot, latestTransaction: null }
    : snapshot;
  return { transactionId: null, contextSnapshot };
}

function parseTypeFilter(raw?: string): SupportCaseType[] | undefined {
  if (!raw?.trim()) return undefined;
  const parts = raw
    .split(',')
    .map((part) => part.trim().toUpperCase())
    .filter(Boolean);
  const resolved = new Set<SupportCaseType>();
  for (const part of parts) {
    if (part === 'COMPLAINT') {
      resolved.add('COMPLAINT_APPEAL');
      resolved.add('COMPLAINT_QUESTION');
    } else if (
      part === 'COMPLAINT_APPEAL' ||
      part === 'COMPLAINT_QUESTION' ||
      part === 'PAYMENT_ISSUE'
    ) {
      resolved.add(part);
    } else {
      throw new BadRequestException(
        'Bộ lọc loại hồ sơ chỉ chấp nhận COMPLAINT_APPEAL, COMPLAINT_QUESTION, PAYMENT_ISSUE hoặc COMPLAINT.',
      );
    }
  }
  return [...resolved];
}

@Injectable()
export class SupportCasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async uploadAttachment(
    actor: AuthenticatedUser,
    file?: Express.Multer.File,
  ) {
    this.assertAllowedRole(actor);
    if (!file?.buffer?.length || file.buffer.length > 5 * 1024 * 1024) {
      throw new BadRequestException(
        'Tệp đính kèm phải có dung lượng từ 1 byte đến 5 MB.',
      );
    }
    const validated = validateUploadedDocumentFile(file, SUPPORT_ATTACHMENT_OPTIONS);
    try {
      const attachmentKey = await this.storage.uploadFile(
        {
          ...file,
          originalname: 'dinh-kem.' + validated.extension,
          mimetype: validated.contentType,
        },
        `${actor.id}/support-cases`,
      );
      return { attachmentKey };
    } catch {
      throw new ServiceUnavailableException(
        'Không tải được tệp đính kèm lên kho lưu trữ. Vui lòng thử lại.',
      );
    }
  }

  async downloadAttachment(
    actor: AuthenticatedUser,
    caseId: string,
    key: string,
  ) {
    this.assertAllowedRole(actor);
    const supportCase = await this.prisma.supportCase.findUnique({
      where: { id: caseId },
      select: {
        id: true,
        familyUserId: true,
        messages: { select: { attachmentKeys: true } },
      },
    });
    if (
      !supportCase ||
      (actor.role !== 'ADMIN' && supportCase.familyUserId !== actor.id)
    ) {
      throw new NotFoundException('Không tìm thấy hồ sơ hỗ trợ.');
    }
    const allowedKeys = new Set<string>();
    for (const msg of supportCase.messages) {
      for (const item of parseAttachmentKeys(msg.attachmentKeys)) {
        allowedKeys.add(item);
      }
    }
    if (!allowedKeys.has(key)) {
      throw new NotFoundException('Không tìm thấy tệp đính kèm trong hồ sơ này.');
    }
    const downloaded = await this.storage.downloadFile(key);
    const fileName = key.split('/').pop() || 'dinh-kem';
    const validated = validateUploadedDocumentFile(
      { buffer: downloaded.bytes, size: downloaded.bytes.length, originalname: fileName },
      SUPPORT_ATTACHMENT_OPTIONS,
    );
    return {
      buffer: validated.buffer,
      mimeType: validated.contentType,
      fileName,
    };
  }

  async createComplaintCase(
    actor: AuthenticatedUser,
    dto: CreateComplaintSupportCaseDto,
  ) {
    if (actor.role !== 'FAMILY_REP') {
      throw new ForbiddenException(
        'Chỉ đại diện hộ gia đình mới có thể gửi yêu cầu xem xét lại hoặc câu hỏi cho khiếu nại.',
      );
    }
    const attachmentKeys = await this.validateAttachmentKeys(
      actor.id,
      dto.attachmentKeys,
    );

    const createdId = await serializable(this.prisma, async (tx) => {
      const complaint = await tx.complaint.findUnique({
        where: { id: dto.complaintId },
        include: {
          contract: {
            include: {
              familyUnit: {
                include: { representativeUser: { select: { fullName: true } } },
              },
              facility: { select: { facilityName: true } },
              doctor: { select: { doctorName: true } },
            },
          },
          supportCases: {
            select: { id: true, caseType: true, status: true },
          },
        },
      });

      if (
        !complaint ||
        complaint.contract.familyUnit.representativeUserId !== actor.id
      ) {
        throw new NotFoundException('Không tìm thấy hồ sơ khiếu nại.');
      }

      const caseType: SupportCaseType =
        dto.mode === 'APPEAL' ? 'COMPLAINT_APPEAL' : 'COMPLAINT_QUESTION';

      if (dto.mode === 'APPEAL') {
        if (complaint.status === 'CLOSED') {
          throw new ConflictException(
            'Hồ sơ khiếu nại đã đóng, không thể yêu cầu xem xét lại. Bạn vẫn có thể gửi câu hỏi trong hồ sơ.',
          );
        }
        if (complaint.status !== 'RESOLVED') {
          throw new ConflictException(
            'Chỉ có thể yêu cầu xem xét lại sau khi khiếu nại đã có kết quả xử lý.',
          );
        }
        if (
          complaint.resolvedAt &&
          Date.now() - complaint.resolvedAt.getTime() > APPEAL_WINDOW_MS
        ) {
          throw new ConflictException(
            'Đã quá thời hạn 7 ngày kể từ khi có kết quả để gửi yêu cầu xem xét lại.',
          );
        }
        const existingAppeal = complaint.supportCases.find(
          (item) => item.caseType === 'COMPLAINT_APPEAL',
        );
        if (existingAppeal) {
          throw new ConflictException({
            message:
              'Khiếu nại này đã có hồ sơ yêu cầu xem xét lại. Vui lòng theo dõi trực tiếp tại hồ sơ hiện có.',
            existingCaseId: existingAppeal.id,
          });
        }
      } else {
        if (!['RESOLVED', 'CLOSED'].includes(complaint.status)) {
          throw new ConflictException(
            'Chỉ có thể gửi câu hỏi sau khi khiếu nại đã có kết quả hoặc đã đóng.',
          );
        }
        const openQuestion = complaint.supportCases.find(
          (item) =>
            item.caseType === 'COMPLAINT_QUESTION' &&
            OPEN_CASE_STATUSES.includes(item.status),
        );
        if (openQuestion) {
          throw new ConflictException({
            message:
              'Bạn đang có một luồng câu hỏi đang được Admin xử lý cho khiếu nại này.',
            existingCaseId: openQuestion.id,
          });
        }
      }

      const contextSnapshot: Prisma.InputJsonValue = {
        complaintCode: complaint.complaintCode,
        complaintCategory: complaint.complaintCategory,
        complaintStatus: complaint.status,
        complaintDescription: complaint.description,
        facilityResponse: complaint.facilityResponse,
        resolutionOutcome: complaint.resolutionOutcome,
        resolutionNotes: complaint.resolutionNotes,
        resolvedAt: complaint.resolvedAt?.toISOString() ?? null,
        contractNumber: complaint.contract.contractNumber,
        facilityName: complaint.contract.facility.facilityName,
        doctorName: complaint.contract.doctor?.doctorName ?? null,
        familyRepName:
          complaint.contract.familyUnit.representativeUser.fullName,
      };

      const created = await tx.supportCase.create({
        data: {
          caseCode: buildCaseCode(caseType),
          caseType,
          status: 'OPEN',
          familyUserId: actor.id,
          contractId: complaint.contractId,
          complaintId: complaint.id,
          contextSnapshot,
        },
      });

      await tx.supportMessage.create({
        data: {
          caseId: created.id,
          senderUserId: actor.id,
          senderRole: 'FAMILY_REP',
          body: dto.message,
          attachmentKeys,
        },
      });

      await writeBusinessAudit(
        tx,
        actor.id,
        dto.mode === 'APPEAL'
          ? 'CREATE_COMPLAINT_APPEAL'
          : 'CREATE_COMPLAINT_QUESTION',
        'support_cases',
        created.id,
      );

      await this.notifyAdmins(
        tx,
        created.id,
        caseType,
        dto.mode === 'APPEAL'
          ? `Yêu cầu xem xét lại khiếu nại ${complaint.complaintCode}`
          : `Câu hỏi mới về khiếu nại ${complaint.complaintCode}`,
        dto.mode === 'APPEAL'
          ? `Gia đình gửi yêu cầu xem xét lại cho hồ sơ ${complaint.complaintCode} (${created.caseCode}).`
          : `Gia đình đặt câu hỏi bổ sung cho hồ sơ ${complaint.complaintCode} (${created.caseCode}).`,
      );

      return created.id;
    });

    return this.getCaseDetail(actor, createdId);
  }

  async createPaymentIssueCase(
    actor: AuthenticatedUser,
    dto: CreatePaymentIssueCaseDto,
  ) {
    if (actor.role !== 'FAMILY_REP') {
      throw new ForbiddenException(
        'Chỉ đại diện hộ gia đình mới có thể gửi báo lỗi chuyển khoản.',
      );
    }
    const attachmentKeys = await this.validateAttachmentKeys(
      actor.id,
      dto.attachmentKeys,
    );

    const createdId = await serializable(this.prisma, async (tx) => {
      const contract = await tx.medicalContract.findUnique({
        where: { id: dto.contractId },
        include: {
          familyUnit: {
            include: { representativeUser: { select: { fullName: true } } },
          },
          facility: { select: { facilityName: true } },
          servicePackage: { select: { packageName: true } },
        },
      });

      if (
        !contract ||
        contract.familyUnit.representativeUserId !== actor.id
      ) {
        throw new NotFoundException(
          'Không tìm thấy hợp đồng thuộc hộ gia đình của bạn.',
        );
      }

      const invoice = dto.invoiceId
        ? await tx.invoice.findFirst({
            where: { id: dto.invoiceId, contractId: contract.id },
          })
        : await tx.invoice.findFirst({
            where: { contractId: contract.id },
            orderBy: { createdAt: 'desc' },
          });

      if (!invoice) {
        throw new BadRequestException(
          'Hợp đồng này chưa có mã yêu cầu thanh toán nào để báo lỗi chuyển khoản.',
        );
      }

      const existingOpen = await tx.supportCase.findFirst({
        where: {
          caseType: 'PAYMENT_ISSUE',
          invoiceId: invoice.id,
          status: { in: OPEN_CASE_STATUSES },
        },
        select: { id: true },
      });

      if (existingOpen) {
        throw new ConflictException({
          message:
            'Hóa đơn này đang có hồ sơ báo lỗi chuyển khoản được Admin xử lý. Vui lòng theo dõi tại hồ sơ hiện có và không chuyển khoản lại.',
          existingCaseId: existingOpen.id,
        });
      }

      const latestTx = await tx.paymentTransaction.findFirst({
        where: findRelatedPaymentTransactions(invoice),
        orderBy: { paymentTime: 'desc' },
      });

      const contextSnapshot: Prisma.InputJsonValue = {
        contractNumber: contract.contractNumber,
        contractStatus: contract.contractStatus,
        packageName: contract.servicePackage.packageName,
        facilityName: contract.facility.facilityName,
        familyRepName: contract.familyUnit.representativeUser.fullName,
        invoiceId: invoice.id,
        paymentCode: invoice.invoiceCode,
        transferContent: invoice.transferContent ?? invoice.invoiceCode,
        amountVnd: moneyToNumber(invoice.totalPayable),
        paymentStatus: invoice.paymentStatus,
        expectedAccountNumber: invoice.expectedAccountNumber,
        expectedGateway: invoice.expectedGateway,
        expiredAt: invoice.expiredAt.toISOString(),
        paidAt: invoice.paidAt?.toISOString() ?? null,
        latestTransaction: latestTx
          ? {
              id: latestTx.id,
              providerTransactionId: latestTx.gatewayTransactionId,
              amountReceived: moneyToNumber(latestTx.amountReceived),
              paymentTime: latestTx.paymentTime.toISOString(),
              outcome: latestTx.outcome,
              reason: latestTx.reason,
              referenceCode: latestTx.referenceCode,
              gateway: latestTx.gateway,
            }
          : null,
      };

      const created = await tx.supportCase.create({
        data: {
          caseCode: buildCaseCode('PAYMENT_ISSUE'),
          caseType: 'PAYMENT_ISSUE',
          status: 'OPEN',
          familyUserId: actor.id,
          contractId: contract.id,
          invoiceId: invoice.id,
          transactionId: latestTx?.id ?? null,
          contextSnapshot,
        },
      });

      await tx.supportMessage.create({
        data: {
          caseId: created.id,
          senderUserId: actor.id,
          senderRole: 'FAMILY_REP',
          body: dto.message,
          attachmentKeys,
        },
      });

      await writeBusinessAudit(
        tx,
        actor.id,
        'CREATE_PAYMENT_ISSUE_CASE',
        'support_cases',
        created.id,
      );

      await this.notifyAdmins(
        tx,
        created.id,
        'PAYMENT_ISSUE',
        `Báo lỗi chuyển khoản ${invoice.invoiceCode}`,
        `Gia đình báo lỗi chuyển khoản cho mã ${invoice.invoiceCode} (${contract.contractNumber}, hồ sơ ${created.caseCode}).`,
      );

      return created.id;
    });

    return this.getCaseDetail(actor, createdId);
  }

  async listCases(actor: AuthenticatedUser, query: ListSupportCasesQueryDto) {
    this.assertAllowedRole(actor);
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(50, Math.max(1, query.limit ?? 20));
    const skip = (page - 1) * limit;

    const where: Prisma.SupportCaseWhereInput = {};
    if (actor.role === 'FAMILY_REP') {
      where.familyUserId = actor.id;
    }
    const parsedTypes = parseTypeFilter(query.type);
    if (parsedTypes?.length) {
      where.caseType =
        parsedTypes.length === 1 ? parsedTypes[0] : { in: parsedTypes };
    }
    if (query.status) {
      where.status = query.status;
    } else if (query.onlyOpen) {
      where.status = { in: OPEN_CASE_STATUSES };
    }
    if (query.complaintId) {
      where.complaintId = query.complaintId;
    }
    if (query.invoiceId) {
      where.invoiceId = query.invoiceId;
    }
    if (query.contractId) {
      where.contractId = query.contractId;
    }

    const [total, rows] = await Promise.all([
      this.prisma.supportCase.count({ where }),
      this.prisma.supportCase.findMany({
        where,
        skip,
        take: limit,
        orderBy: { updatedAt: 'desc' },
        include: CASE_LIST_INCLUDE,
      }),
    ]);

    return {
      items: rows.map((row) => this.formatCaseSummary(row)),
      total,
      page,
      limit,
    };
  }

  async getCaseDetail(actor: AuthenticatedUser, id: string) {
    this.assertAllowedRole(actor);
    const row = await this.prisma.supportCase.findUnique({
      where: { id },
      include: CASE_DETAIL_INCLUDE,
    });
    if (!row || (actor.role !== 'ADMIN' && row.familyUserId !== actor.id)) {
      throw new NotFoundException('Không tìm thấy hồ sơ hỗ trợ.');
    }

    const relatedTransactions =
      row.caseType === 'PAYMENT_ISSUE' && row.invoice
        ? await this.prisma.paymentTransaction.findMany({
            where: findRelatedPaymentTransactions(row.invoice),
            orderBy: { paymentTime: 'desc' },
            take: 10,
          })
        : [];

    return this.formatCaseDetail(row, relatedTransactions);
  }

  async postMessage(
    actor: AuthenticatedUser,
    caseId: string,
    dto: PostSupportMessageDto,
  ) {
    this.assertAllowedRole(actor);
    const attachmentKeys = await this.validateAttachmentKeys(
      actor.id,
      dto.attachmentKeys,
    );

    await serializable(this.prisma, async (tx) => {
      const existing = await tx.supportCase.findUnique({
        where: { id: caseId },
        include: {
          messages: {
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            select: { senderRole: true, isSupplement: true },
          },
        },
      });

      if (
        !existing ||
        (actor.role !== 'ADMIN' && existing.familyUserId !== actor.id)
      ) {
        throw new NotFoundException('Không tìm thấy hồ sơ hỗ trợ.');
      }

      if (existing.status === 'RESOLVED' || existing.status === 'CLOSED') {
        throw new ConflictException(
          'Hồ sơ hỗ trợ đã có kết quả hoặc đã đóng, không thể gửi thêm tin nhắn.',
        );
      }

      const isSupplement =
        actor.role === 'FAMILY_REP' && existing.status === 'NEED_MORE_INFO';
      if (actor.role === 'FAMILY_REP' && !isSupplement &&
          remainingFamilyReplies(existing.messages) === 0) {
        throw new ConflictException(
          'Bạn đã hết lượt gửi trong khi chờ Admin phản hồi. Vui lòng đợi Admin trả lời trước khi gửi thêm.',
        );
      }

      await tx.supportMessage.create({
        data: {
          caseId: existing.id,
          senderUserId: actor.id,
          senderRole: actor.role,
          body: dto.body,
          attachmentKeys,
          isSupplement,
        },
      });

      let nextStatus = existing.status;
      if (isSupplement) {
        nextStatus = 'IN_REVIEW';
      } else if (actor.role === 'ADMIN' && existing.status === 'OPEN') {
        nextStatus = 'IN_REVIEW';
      }

      await tx.supportCase.update({
        where: { id: existing.id },
        data: { status: nextStatus, updatedAt: new Date() },
      });

      if (actor.role === 'FAMILY_REP') {
        await this.notifyAdmins(
          tx,
          existing.id,
          existing.caseType,
          `Gia đình phản hồi hồ sơ ${existing.caseCode}`,
          existing.status === 'NEED_MORE_INFO'
            ? `Gia đình đã bổ sung thông tin cho hồ sơ ${existing.caseCode}.`
            : `Gia đình vừa gửi thêm phản hồi trong hồ sơ ${existing.caseCode}.`,
        );
      } else {
        await tx.notification.create({
          data: {
            userId: existing.familyUserId,
            title: `Admin đã phản hồi hồ sơ ${existing.caseCode}`,
            content:
              'Ban quản trị FamiDoc đã gửi phản hồi mới trong hồ sơ hỗ trợ của bạn. Vui lòng mở để theo dõi.',
            type: notificationTypeForCase(existing.caseType),
            referenceId: existing.id,
          },
        });
      }
    });

    return this.getCaseDetail(actor, caseId);
  }

  async updateStatus(
    actor: AuthenticatedUser,
    caseId: string,
    dto: UpdateSupportCaseStatusDto,
  ) {
    if (actor.role !== 'ADMIN') {
      throw new ForbiddenException(
        'Chỉ Quản trị viên mới có quyền cập nhật trạng thái hồ sơ hỗ trợ.',
      );
    }

    const replyMessage = dto.replyMessage?.trim();
    if (dto.status === 'NEED_MORE_INFO' && (!replyMessage || replyMessage.length < 2)) {
      throw new BadRequestException('Vui lòng ghi rõ thông tin gia đình cần bổ sung.');
    }

    await serializable(this.prisma, async (tx) => {
      const existing = await tx.supportCase.findUnique({
        where: { id: caseId },
      });
      if (!existing) {
        throw new NotFoundException('Không tìm thấy hồ sơ hỗ trợ.');
      }
      if (existing.status === 'CLOSED') {
        throw new ConflictException(
          'Hồ sơ đã đóng, không thể thay đổi trạng thái.',
        );
      }
      if (existing.status === 'RESOLVED' && dto.status !== 'CLOSED') {
        throw new ConflictException(
          'Hồ sơ đã có kết quả, chỉ có thể chuyển sang trạng thái Đã đóng.',
        );
      }
      if (dto.status === 'RESOLVED' && !dto.resolutionSummary) {
        throw new BadRequestException(
          'Vui lòng nhập kết luận xử lý (tối thiểu 10 ký tự) khi chốt kết quả hồ sơ.',
        );
      }

      const updateData: Prisma.SupportCaseUncheckedUpdateInput = {
        status: dto.status,
      };
      if (dto.status === 'RESOLVED') {
        updateData.resolutionSummary = dto.resolutionSummary;
        updateData.resolvedByUserId = actor.id;
        updateData.resolvedAt = new Date();
      }

      await tx.supportCase.update({
        where: { id: existing.id },
        data: updateData,
      });

      const messageBody =
        replyMessage ||
        (dto.status === 'RESOLVED' && dto.resolutionSummary
          ? `Kết luận xử lý: ${dto.resolutionSummary}`
          : undefined);

      if (messageBody) {
        await tx.supportMessage.create({
          data: {
            caseId: existing.id,
            senderUserId: actor.id,
            senderRole: 'ADMIN',
            body: messageBody,
            attachmentKeys: [],
          },
        });
      }

      await writeBusinessAudit(
        tx,
        actor.id,
        'UPDATE_SUPPORT_CASE_STATUS',
        'support_cases',
        existing.id,
      );

      await tx.notification.create({
        data: {
          userId: existing.familyUserId,
          title: `${statusTitleForFamily(dto.status)} (${existing.caseCode})`,
          content:
            dto.status === 'NEED_MORE_INFO'
              ? 'Ban quản trị FamiDoc cần gia đình cung cấp thêm thông tin hoặc chứng từ trong hồ sơ hỗ trợ.'
              : dto.status === 'RESOLVED'
                ? 'Ban quản trị FamiDoc đã cập nhật kết quả xử lý cho hồ sơ hỗ trợ của bạn.'
                : `Hồ sơ hỗ trợ ${existing.caseCode} đã được cập nhật trạng thái mới.`,
          type: notificationTypeForCase(existing.caseType),
          referenceId: existing.id,
        },
      });
    });

    return this.getCaseDetail(actor, caseId);
  }

  private assertAllowedRole(actor: AuthenticatedUser) {
    if (!['FAMILY_REP', 'ADMIN'].includes(actor.role)) {
      throw new ForbiddenException(
        'Chỉ đại diện hộ gia đình hoặc Quản trị viên mới có quyền truy cập hồ sơ hỗ trợ này.',
      );
    }
  }

  private async validateAttachmentKeys(
    actorId: string,
    rawKeys?: string[],
  ): Promise<string[]> {
    if (!rawKeys?.length) return [];
    const keys = [...new Set(rawKeys.map((k) => k.trim()).filter(Boolean))];
    if (keys.length > 5) {
      throw new BadRequestException(
        'Chỉ được đính kèm tối đa 5 tệp trong một lượt gửi.',
      );
    }
    const prefix = `${actorId}/support-cases/`;
    if (
      keys.some(
        (key) =>
          !key.startsWith(prefix) || key.includes('..') || key.includes('://'),
      )
    ) {
      throw new BadRequestException(
        'Đường dẫn tệp đính kèm không thuộc vùng tải lên hợp lệ của bạn.',
      );
    }
    const exists = await Promise.all(
      keys.map((key) => this.storage.objectExists(key)),
    );
    if (exists.includes(false)) {
      throw new BadRequestException(
        'Có tệp đính kèm chưa được tải lên hợp lệ. Vui lòng thử tải lại.',
      );
    }
    return keys;
  }

  private async notifyAdmins(
    tx: Prisma.TransactionClient,
    caseId: string,
    caseType: SupportCaseType,
    title: string,
    content: string,
  ) {
    const admins = await tx.user.findMany({
      where: { role: 'ADMIN', status: 'ACTIVE' },
      select: { id: true },
    });
    if (!admins.length) return;
    await tx.notification.createMany({
      data: admins.map((admin) => ({
        userId: admin.id,
        title,
        content,
        type: notificationTypeForCase(caseType),
        referenceId: caseId,
      })),
    });
  }

  private formatCaseSummary(row: CaseListRow) {
    const lastMessage = row.messages[0] ?? null;
    return {
      id: row.id,
      caseCode: row.caseCode,
      caseType: row.caseType,
      status: row.status,
      familyUserId: row.familyUserId,
      contractId: row.contractId,
      complaintId: row.complaintId,
      invoiceId: row.invoiceId,
      ...casePaymentContext(row),
      resolutionSummary: row.resolutionSummary,
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      messageCount: row._count.messages,
      lastMessage: lastMessage
        ? {
            id: lastMessage.id,
            senderRole: lastMessage.senderRole,
            body: lastMessage.body,
            createdAt: lastMessage.createdAt.toISOString(),
          }
        : null,
      familyUser: row.familyUser,
      contract: {
        id: row.contract.id,
        contractNumber: row.contract.contractNumber,
        contractStatus: row.contract.contractStatus,
        facilityName: row.contract.facility.facilityName,
        packageName: row.contract.servicePackage.packageName,
      },
      complaint: row.complaint,
      invoice: row.invoice
        ? {
            id: row.invoice.id,
            invoiceCode: row.invoice.invoiceCode,
            addendumId: row.invoice.addendumId,
            totalPayable: moneyToNumber(row.invoice.totalPayable),
            paymentStatus: row.invoice.paymentStatus,
            paidAt: row.invoice.paidAt?.toISOString() ?? null,
          }
        : null,
    };
  }

  private formatCaseDetail(
    row: CaseDetailRow,
    relatedTransactions: Array<{
      id: string;
      gatewayTransactionId: string;
      amountReceived: Prisma.Decimal;
      paymentTime: Date;
      outcome: string;
      reason: string | null;
      referenceCode: string;
      gateway: string;
      accountNumber: string;
      paymentCode: string | null;
      webhookPayload: Prisma.JsonValue;
    }>,
  ) {
    const isClosedOrResolved =
      row.status === 'RESOLVED' || row.status === 'CLOSED';
    const remainingFamilyMessages = isClosedOrResolved
      ? 0
      : row.status === 'NEED_MORE_INFO'
        ? 1
        : remainingFamilyReplies(row.messages);

    return {
      id: row.id,
      caseCode: row.caseCode,
      caseType: row.caseType,
      status: row.status,
      familyUserId: row.familyUserId,
      contractId: row.contractId,
      complaintId: row.complaintId,
      invoiceId: row.invoiceId,
      ...casePaymentContext(row),
      resolutionSummary: row.resolutionSummary,
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
      resolvedBy: row.resolver,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      familyUser: row.familyUser,
      contract: {
        id: row.contract.id,
        contractNumber: row.contract.contractNumber,
        contractStatus: row.contract.contractStatus,
        facilityName: row.contract.facility.facilityName,
        doctorName: row.contract.doctor?.doctorName ?? null,
        packageName: row.contract.servicePackage.packageName,
      },
      complaint: row.complaint
        ? {
            ...row.complaint,
            evidenceAttachments: parseAttachmentKeys(
              row.complaint.evidenceAttachments,
            ),
            facilityReviewedAt:
              row.complaint.facilityReviewedAt?.toISOString() ?? null,
            resolvedAt: row.complaint.resolvedAt?.toISOString() ?? null,
            createdAt: row.complaint.createdAt.toISOString(),
          }
        : null,
      invoice: row.invoice
        ? {
            id: row.invoice.id,
            invoiceCode: row.invoice.invoiceCode,
            transferContent:
              row.invoice.transferContent ?? row.invoice.invoiceCode,
            totalPayable: moneyToNumber(row.invoice.totalPayable),
            paymentStatus: row.invoice.paymentStatus,
            expectedAccountNumber: row.invoice.expectedAccountNumber,
            expectedGateway: row.invoice.expectedGateway,
            expiredAt: row.invoice.expiredAt.toISOString(),
            paidAt: row.invoice.paidAt?.toISOString() ?? null,
            createdAt: row.invoice.createdAt.toISOString(),
          }
        : null,
      relatedTransactions: relatedTransactions.map((tx) => ({
        id: tx.id,
        providerTransactionId: tx.gatewayTransactionId,
        amountReceived: moneyToNumber(tx.amountReceived),
        paymentTime: tx.paymentTime.toISOString(),
        outcome: tx.outcome,
        reason: tx.reason,
        referenceCode: tx.referenceCode,
        gateway: tx.gateway,
        accountNumber: tx.accountNumber,
        paymentCode: tx.paymentCode,
        transferContent: extractTransferContentFromPayload(tx.webhookPayload),
      })),
      familyCanReply: remainingFamilyMessages > 0,
      remainingFamilyMessages,
      messages: row.messages.map((msg) => ({
        id: msg.id,
        caseId: msg.caseId,
        senderUserId: msg.senderUserId,
        senderRole: msg.senderRole,
        senderName: msg.senderUser.fullName,
        body: msg.body,
        attachmentKeys: parseAttachmentKeys(msg.attachmentKeys),
        createdAt: msg.createdAt.toISOString(),
      })),
    };
  }
}
