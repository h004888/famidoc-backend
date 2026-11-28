import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../../core/auth/authenticated-request';
import type { PrismaService } from '../../../core/database/prisma.service';
import type { StorageService } from '../../../core/services/storage.service';
import { SupportCasesService } from '../services/support-cases.service';

const FAMILY_ACTOR: AuthenticatedUser = {
  id: '11111111-1111-4111-8111-111111111111',
  role: 'FAMILY_REP',
  familyUnitId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
};

const OTHER_FAMILY_ACTOR: AuthenticatedUser = {
  id: '22222222-2222-4222-8222-222222222222',
  role: 'FAMILY_REP',
  familyUnitId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
};

const ADMIN_ACTOR: AuthenticatedUser = {
  id: '33333333-3333-4333-8333-333333333333',
  role: 'ADMIN',
  familyUnitId: null,
};

const FACILITY_ACTOR: AuthenticatedUser = {
  id: '44444444-4444-4444-8444-444444444444',
  role: 'HEALTHCARE_FACILITY',
  familyUnitId: null,
};

const CONTRACT_ID = '55555555-5555-4555-8555-555555555555';
const COMPLAINT_ID = '66666666-6666-4666-8666-666666666666';
const INVOICE_ID = '77777777-7777-4777-8777-777777777777';
const CASE_ID = '88888888-8888-4888-8888-888888888888';
const PNG_BYTES = Buffer.from('89504e470d0a1a0a00', 'hex');

function makeDetailRow(overrides: Record<string, unknown> = {}) {
  const now = new Date('2026-11-22T10:00:00.000Z');
  return {
    id: CASE_ID,
    caseCode: 'XL-ABCDEF12',
    caseType: 'COMPLAINT_APPEAL',
    status: 'OPEN',
    familyUserId: FAMILY_ACTOR.id,
    contractId: CONTRACT_ID,
    complaintId: COMPLAINT_ID,
    invoiceId: null,
    transactionId: null,
    contextSnapshot: { complaintCode: 'CP001' },
    resolutionSummary: null,
    resolvedByUserId: null,
    resolvedAt: null,
    createdAt: now,
    updatedAt: now,
    familyUser: {
      id: FAMILY_ACTOR.id,
      fullName: 'Nguyễn Gia Đình',
      phone: '0901234567',
    },
    resolver: null,
    contract: {
      id: CONTRACT_ID,
      contractNumber: 'HD-2026-001',
      contractStatus: 'ACTIVE',
      facility: { facilityName: 'Phòng khám FamiCare' },
      doctor: { doctorName: 'BS. Trần Minh' },
      servicePackage: { packageName: 'Gói Chăm Sóc Toàn Diện' },
    },
    complaint: {
      id: COMPLAINT_ID,
      complaintCode: 'CP001',
      complaintCategory: 'MISSED_VISIT',
      description: 'Bác sĩ đến trễ buổi khám định kỳ.',
      evidenceAttachments: [],
      facilityResponse: 'CSYT xác nhận bác sĩ kẹt xe 20 phút.',
      facilityReviewedAt: now,
      resolutionOutcome: 'WARNING',
      resolutionNotes: 'Nhắc nhở bác sĩ tuân thủ giờ hẹn.',
      status: 'RESOLVED',
      resolvedAt: now,
      createdAt: now,
    },
    invoice: null,
    messages: [
      {
        id: '99999999-9999-4999-8999-999999999999',
        caseId: CASE_ID,
        senderUserId: FAMILY_ACTOR.id,
        senderRole: 'FAMILY_REP',
        body: 'Gia đình muốn xem xét lại kết quả vì buổi khám bị hủy hoàn toàn.',
        attachmentKeys: [],
        createdAt: now,
        senderUser: {
          id: FAMILY_ACTOR.id,
          fullName: 'Nguyễn Gia Đình',
          role: 'FAMILY_REP',
        },
      },
    ],
    ...overrides,
  };
}

function createMocks() {
  const tx = {
    complaint: { findUnique: jest.fn() },
    medicalContract: { findUnique: jest.fn() },
    invoice: { findFirst: jest.fn() },
    paymentTransaction: { findFirst: jest.fn(), findMany: jest.fn() },
    supportCase: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
    supportMessage: { create: jest.fn() },
    auditLog: { create: jest.fn() },
    user: { findMany: jest.fn().mockResolvedValue([{ id: ADMIN_ACTOR.id }]) },
    notification: { create: jest.fn(), createMany: jest.fn() },
  };

  const prisma = {
    ...tx,
    $transaction: jest.fn(async (cb: (client: typeof tx) => Promise<unknown>) =>
      cb(tx),
    ),
  };

  const storage = {
    uploadFile: jest
      .fn()
      .mockResolvedValue(`${FAMILY_ACTOR.id}/support-cases/17000-1.png`),
    objectExists: jest.fn().mockResolvedValue(true),
    downloadFile: jest.fn().mockResolvedValue({
      bytes: PNG_BYTES,
      contentType: 'application/octet-stream',
    }),
  };

  const service = new SupportCasesService(
    prisma as unknown as PrismaService,
    storage as unknown as StorageService,
  );

  return { service, prisma, tx, storage };
}

describe('SupportCasesService', () => {
  it('chặn CSYT và Bác sĩ truy cập danh sách hoặc tải tệp hồ sơ hỗ trợ', async () => {
    const { service } = createMocks();
    await expect(service.listCases(FACILITY_ACTOR, {})).rejects.toThrow(
      ForbiddenException,
    );
    await expect(
      service.uploadAttachment(FACILITY_ACTOR, {
        buffer: Buffer.from('abc'),
        mimetype: 'image/png',
        originalname: 'a.png',
      } as Express.Multer.File),
    ).rejects.toThrow(ForbiddenException);
  });

  it('cho phép gia đình tạo yêu cầu xem xét lại trên khiếu nại RESOLVED trong hạn 7 ngày và giữ nguyên phán quyết gốc', async () => {
    const { service, tx } = createMocks();
    const resolvedAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    tx.complaint.findUnique.mockResolvedValue({
      id: COMPLAINT_ID,
      complaintCode: 'CP001',
      complaintCategory: 'MISSED_VISIT',
      status: 'RESOLVED',
      description: 'Bỏ lỡ lịch hẹn',
      facilityResponse: 'CSYT xác nhận có sự cố',
      resolutionOutcome: 'WARNING',
      resolutionNotes: 'Đã nhắc nhở bác sĩ',
      resolvedAt,
      contractId: CONTRACT_ID,
      contract: {
        contractNumber: 'HD-2026-001',
        familyUnit: {
          representativeUserId: FAMILY_ACTOR.id,
          representativeUser: { fullName: 'Nguyễn Gia Đình' },
        },
        facility: { facilityName: 'Phòng khám FamiCare' },
        doctor: { doctorName: 'BS. Trần Minh' },
      },
      supportCases: [],
    });
    tx.supportCase.create.mockResolvedValue({
      id: CASE_ID,
      caseCode: 'XL-ABCDEF12',
    });
    tx.supportCase.findUnique.mockResolvedValue(makeDetailRow());

    const result = await service.createComplaintCase(FAMILY_ACTOR, {
      complaintId: COMPLAINT_ID,
      mode: 'APPEAL',
      message: 'Gia đình không đồng ý kết luận vì buổi khám chưa được bù.',
      attachmentKeys: [`${FAMILY_ACTOR.id}/support-cases/evidence.png`],
    });

    expect(result.caseType).toBe('COMPLAINT_APPEAL');
    expect(tx.supportCase.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          caseType: 'COMPLAINT_APPEAL',
          complaintId: COMPLAINT_ID,
          familyUserId: FAMILY_ACTOR.id,
          contextSnapshot: expect.objectContaining({
            resolutionOutcome: 'WARNING',
            resolutionNotes: 'Đã nhắc nhở bác sĩ',
          }),
        }),
      }),
    );
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    expect(tx.notification.createMany).toHaveBeenCalledTimes(1);
  });

  it('chặn yêu cầu xem xét lại quá hạn 7 ngày, đã CLOSED hoặc tạo lần 2', async () => {
    const { service, tx } = createMocks();
    const baseComplaint = {
      id: COMPLAINT_ID,
      complaintCode: 'CP001',
      complaintCategory: 'MISSED_VISIT',
      status: 'RESOLVED',
      description: 'Mô tả',
      facilityResponse: null,
      resolutionOutcome: 'WARNING',
      resolutionNotes: 'Ghi chú',
      resolvedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      contractId: CONTRACT_ID,
      contract: {
        contractNumber: 'HD-2026-001',
        familyUnit: {
          representativeUserId: FAMILY_ACTOR.id,
          representativeUser: { fullName: 'Nguyễn Gia Đình' },
        },
        facility: { facilityName: 'PK' },
        doctor: null,
      },
      supportCases: [],
    };

    tx.complaint.findUnique.mockResolvedValueOnce(baseComplaint);
    await expect(
      service.createComplaintCase(FAMILY_ACTOR, {
        complaintId: COMPLAINT_ID,
        mode: 'APPEAL',
        message: 'Xin xem xét lại sau khi quá 7 ngày.',
      }),
    ).rejects.toThrow(ConflictException);

    tx.complaint.findUnique.mockResolvedValueOnce({
      ...baseComplaint,
      status: 'CLOSED',
      resolvedAt: new Date(),
    });
    await expect(
      service.createComplaintCase(FAMILY_ACTOR, {
        complaintId: COMPLAINT_ID,
        mode: 'APPEAL',
        message: 'Xin xem xét lại khi đã đóng hồ sơ.',
      }),
    ).rejects.toThrow(ConflictException);

    tx.complaint.findUnique.mockResolvedValueOnce({
      ...baseComplaint,
      status: 'RESOLVED',
      resolvedAt: new Date(),
      supportCases: [
        { id: CASE_ID, caseType: 'COMPLAINT_APPEAL', status: 'RESOLVED' },
      ],
    });
    await expect(
      service.createComplaintCase(FAMILY_ACTOR, {
        complaintId: COMPLAINT_ID,
        mode: 'APPEAL',
        message: 'Gửi yêu cầu xem xét lại lần thứ hai.',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('cho phép gửi câu hỏi khi khiếu nại đã CLOSED mà không mở lại khiếu nại', async () => {
    const { service, tx } = createMocks();
    tx.complaint.findUnique.mockResolvedValue({
      id: COMPLAINT_ID,
      complaintCode: 'CP001',
      complaintCategory: 'OTHER',
      status: 'CLOSED',
      description: 'Mô tả',
      facilityResponse: 'Phản hồi',
      resolutionOutcome: 'DISMISSED',
      resolutionNotes: 'Không đủ căn cứ',
      resolvedAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
      contractId: CONTRACT_ID,
      contract: {
        contractNumber: 'HD-2026-001',
        familyUnit: {
          representativeUserId: FAMILY_ACTOR.id,
          representativeUser: { fullName: 'Nguyễn Gia Đình' },
        },
        facility: { facilityName: 'PK' },
        doctor: null,
      },
      supportCases: [],
    });
    tx.supportCase.create.mockResolvedValue({
      id: CASE_ID,
      caseCode: 'CH-11223344',
    });
    tx.supportCase.findUnique.mockResolvedValue(
      makeDetailRow({ caseType: 'COMPLAINT_QUESTION', caseCode: 'CH-11223344' }),
    );

    const res = await service.createComplaintCase(FAMILY_ACTOR, {
      complaintId: COMPLAINT_ID,
      mode: 'QUESTION',
      message: 'Xin hỏi thêm lý do vì sao hồ sơ không đủ căn cứ.',
    });
    expect(res.caseType).toBe('COMPLAINT_QUESTION');
  });

  it('tạo hồ sơ báo lỗi chuyển khoản tự động chụp hóa đơn + SePay transaction và chặn tạo trùng khi đang mở', async () => {
    const { service, tx } = createMocks();
    const now = new Date('2026-11-22T10:00:00.000Z');
    tx.medicalContract.findUnique.mockResolvedValue({
      id: CONTRACT_ID,
      contractNumber: 'HD-2026-001',
      contractStatus: 'PENDING_PAYMENT',
      familyUnit: {
        representativeUserId: FAMILY_ACTOR.id,
        representativeUser: { fullName: 'Nguyễn Gia Đình' },
      },
      facility: { facilityName: 'Phòng khám FamiCare' },
      servicePackage: { packageName: 'Gói Gia Đình 6 Tháng' },
    });
    tx.invoice.findFirst.mockResolvedValue({
      id: INVOICE_ID,
      contractId: CONTRACT_ID,
      invoiceCode: 'FD998877',
      transferContent: 'NGUYEN GIA DINH FD998877',
      totalPayable: new Prisma.Decimal(1500000),
      paymentStatus: 'PENDING',
      environment: 'LIVE',
      expectedAccountNumber: '0987654321',
      expectedGateway: 'MBBank',
      expiredAt: now,
      paidAt: null,
      createdAt: now,
    });
    tx.supportCase.findFirst.mockResolvedValueOnce(null);
    tx.paymentTransaction.findFirst.mockResolvedValue({
      id: 'tx-sepay-1',
      gatewayTransactionId: 'SP-1001',
      amountReceived: new Prisma.Decimal(1500000),
      paymentTime: now,
      outcome: 'REVIEW_REQUIRED',
      reason: 'LATE_PAYMENT',
      referenceCode: 'FT261122001',
      gateway: 'MBBank',
    });
    tx.supportCase.create.mockResolvedValue({
      id: CASE_ID,
      caseCode: 'CK-99887766',
    });
    tx.supportCase.findUnique.mockResolvedValue(
      makeDetailRow({
        caseType: 'PAYMENT_ISSUE',
        caseCode: 'CK-99887766',
        complaintId: null,
        complaint: null,
        invoiceId: INVOICE_ID,
        transactionId: 'old-test-transaction',
        transaction: { environment: 'TEST' },
        contextSnapshot: { latestTransaction: { id: 'old-test-transaction' } },
        invoice: {
          id: INVOICE_ID,
          invoiceCode: 'FD998877',
          transferContent: 'NGUYEN GIA DINH FD998877',
          totalPayable: new Prisma.Decimal(1500000),
          paymentStatus: 'PENDING',
          environment: 'LIVE',
          expectedAccountNumber: '0987654321',
          expectedGateway: 'MBBank',
          expiredAt: now,
          paidAt: null,
          createdAt: now,
        },
      }),
    );
    tx.paymentTransaction.findMany.mockResolvedValue([]);

    const created = await service.createPaymentIssueCase(FAMILY_ACTOR, {
      contractId: CONTRACT_ID,
      invoiceId: INVOICE_ID,
      message: 'Tôi đã chuyển khoản 1.500.000đ nhưng gói vẫn chưa kích hoạt.',
    });

    expect(created.caseType).toBe('PAYMENT_ISSUE');
    expect(created.transactionId).toBeNull();
    expect(created.contextSnapshot).toMatchObject({ latestTransaction: null });
    const expectedPaymentScope = {
      environment: 'LIVE',
      OR: [{ invoiceId: INVOICE_ID }, { invoiceId: null, paymentCode: 'FD998877' }],
    };
    expect(tx.paymentTransaction.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expectedPaymentScope }),
    );
    expect(tx.paymentTransaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expectedPaymentScope }),
    );
    expect(tx.supportCase.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          caseType: 'PAYMENT_ISSUE',
          invoiceId: INVOICE_ID,
          transactionId: 'tx-sepay-1',
          contextSnapshot: expect.objectContaining({
            paymentCode: 'FD998877',
            amountVnd: 1500000,
          }),
        }),
      }),
    );

    // Tạo trùng khi đang có hồ sơ mở -> 409 Conflict
    tx.supportCase.findFirst.mockResolvedValueOnce({ id: CASE_ID });
    await expect(
      service.createPaymentIssueCase(FAMILY_ACTOR, {
        contractId: CONTRACT_ID,
        invoiceId: INVOICE_ID,
        message: 'Báo lỗi lại lần hai cho cùng hóa đơn.',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('chặn hộ gia đình khác xem chi tiết hồ sơ hỗ trợ', async () => {
    const { service, tx } = createMocks();
    tx.supportCase.findUnique.mockResolvedValue(makeDetailRow());
    await expect(
      service.getCaseDetail(OTHER_FAMILY_ACTOR, CASE_ID),
    ).rejects.toThrow(NotFoundException);
  });

  it('áp dụng luật chống spam tối đa 2 tin liên tiếp và tự chuyển NEED_MORE_INFO -> IN_REVIEW khi gia đình bổ sung', async () => {
    const { service, tx } = createMocks();

    // Đã có 2 tin liên tiếp từ FAMILY_REP ở trạng thái OPEN -> chặn tin thứ 3
    tx.supportCase.findUnique.mockResolvedValueOnce({
      id: CASE_ID,
      caseCode: 'CK-99887766',
      caseType: 'PAYMENT_ISSUE',
      status: 'OPEN',
      familyUserId: FAMILY_ACTOR.id,
      messages: [
        { senderRole: 'FAMILY_REP' },
        { senderRole: 'FAMILY_REP' },
      ],
    });
    await expect(
      service.postMessage(FAMILY_ACTOR, CASE_ID, {
        body: 'Nhắn thêm lần 3 liên tiếp',
      }),
    ).rejects.toThrow(ConflictException);

    // Khi Admin chuyển sang NEED_MORE_INFO, gia đình được phép bổ sung và hồ sơ tự quay lại IN_REVIEW
    tx.supportCase.findUnique
      .mockResolvedValueOnce({
        id: CASE_ID,
        caseCode: 'CK-99887766',
        caseType: 'PAYMENT_ISSUE',
        status: 'NEED_MORE_INFO',
        familyUserId: FAMILY_ACTOR.id,
        messages: [
          { senderRole: 'FAMILY_REP' },
          { senderRole: 'FAMILY_REP' },
        ],
      })
      .mockResolvedValueOnce(makeDetailRow({ status: 'IN_REVIEW' }));

    const updated = await service.postMessage(FAMILY_ACTOR, CASE_ID, {
      body: 'Tôi gửi bổ sung ảnh biên lai chuyển khoản.',
    });

    expect(tx.supportCase.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: CASE_ID },
        data: expect.objectContaining({ status: 'IN_REVIEW' }),
      }),
    );
    expect(updated.status).toBe('IN_REVIEW');
    expect(tx.supportMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isSupplement: true }) }),
    );

    const supplement = makeDetailRow().messages[0];
    const afterSupplement = makeDetailRow({
      status: 'IN_REVIEW',
      messages: [{ ...supplement, isSupplement: true }],
    });
    tx.supportCase.findUnique.mockResolvedValue(afterSupplement);
    await expect(service.getCaseDetail(FAMILY_ACTOR, CASE_ID)).resolves.toMatchObject({
      familyCanReply: false,
      remainingFamilyMessages: 0,
    });
    await expect(service.postMessage(FAMILY_ACTOR, CASE_ID, { body: 'Gửi thêm một lượt' }))
      .rejects.toThrow(ConflictException);
  });

  it('chỉ cấp một lượt bổ sung và yêu cầu Admin nêu nội dung cần bổ sung', async () => {
    const { service, tx } = createMocks();
    const awaitingEvidence = makeDetailRow({ status: 'NEED_MORE_INFO' });
    tx.supportCase.findUnique.mockResolvedValue(awaitingEvidence);
    await expect(service.getCaseDetail(FAMILY_ACTOR, CASE_ID)).resolves.toMatchObject({
      familyCanReply: true,
      remainingFamilyMessages: 1,
    });
    await expect(
      service.updateStatus(ADMIN_ACTOR, CASE_ID, { status: 'NEED_MORE_INFO', replyMessage: '  ' }),
    ).rejects.toThrow(BadRequestException);
    expect(tx.supportCase.update).not.toHaveBeenCalled();

    await service.updateStatus(ADMIN_ACTOR, CASE_ID, {
      status: 'NEED_MORE_INFO',
      replyMessage: 'Vui lòng gửi mã tham chiếu ngân hàng.',
    });
    expect(tx.supportMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          senderRole: 'ADMIN',
          body: 'Vui lòng gửi mã tham chiếu ngân hàng.',
        }),
      }),
    );
  });

  it('Admin cập nhật trạng thái RESOLVED bắt buộc có resolutionSummary và chặn cập nhật khi đã CLOSED', async () => {
    const { service, tx } = createMocks();
    tx.supportCase.findUnique.mockResolvedValueOnce({
      id: CASE_ID,
      caseCode: 'XL-ABCDEF12',
      caseType: 'COMPLAINT_APPEAL',
      status: 'IN_REVIEW',
      familyUserId: FAMILY_ACTOR.id,
    });
    await expect(
      service.updateStatus(ADMIN_ACTOR, CASE_ID, {
        status: 'RESOLVED',
      }),
    ).rejects.toThrow(BadRequestException);

    tx.supportCase.findUnique.mockResolvedValueOnce({
      id: CASE_ID,
      caseCode: 'XL-ABCDEF12',
      caseType: 'COMPLAINT_APPEAL',
      status: 'CLOSED',
      familyUserId: FAMILY_ACTOR.id,
    });
    await expect(
      service.updateStatus(ADMIN_ACTOR, CASE_ID, {
        status: 'IN_REVIEW',
      }),
    ).rejects.toThrow(ConflictException);

    tx.supportCase.findUnique
      .mockResolvedValueOnce({
        id: CASE_ID,
        caseCode: 'XL-ABCDEF12',
        caseType: 'COMPLAINT_APPEAL',
        status: 'IN_REVIEW',
        familyUserId: FAMILY_ACTOR.id,
      })
      .mockResolvedValueOnce(
        makeDetailRow({
          status: 'RESOLVED',
          resolutionSummary: 'Giữ nguyên kết quả và bổ sung lịch khám bù.',
        }),
      );

    const resolved = await service.updateStatus(ADMIN_ACTOR, CASE_ID, {
      status: 'RESOLVED',
      resolutionSummary: 'Giữ nguyên kết quả và bổ sung lịch khám bù.',
    });
    expect(resolved.status).toBe('RESOLVED');
    expect(tx.supportMessage.create).toHaveBeenCalledTimes(1);
    expect(tx.notification.create).toHaveBeenCalledTimes(1);
  });

  it('kiểm tra upload tệp đúng định dạng/dung lượng và chặn tải tệp không thuộc hồ sơ', async () => {
    const { service, tx, storage } = createMocks();

    await expect(
      service.uploadAttachment(FAMILY_ACTOR, {
        buffer: Buffer.from('hello'),
        mimetype: 'image/png',
        originalname: 'note.png',
      } as Express.Multer.File),
    ).rejects.toThrow(BadRequestException);

    const uploaded = await service.uploadAttachment(FAMILY_ACTOR, {
      buffer: PNG_BYTES,
      mimetype: 'application/octet-stream',
      originalname: 'bien-lai.pdf',
    } as Express.Multer.File);
    expect(uploaded.attachmentKey).toContain(`${FAMILY_ACTOR.id}/support-cases/`);
    expect(storage.uploadFile).toHaveBeenCalledTimes(1);
    expect(storage.uploadFile).toHaveBeenCalledWith(
      expect.objectContaining({ mimetype: 'image/png', originalname: 'dinh-kem.png' }),
      FAMILY_ACTOR.id + '/support-cases',
    );

    tx.supportCase.findUnique.mockResolvedValue({
      id: CASE_ID,
      familyUserId: FAMILY_ACTOR.id,
      messages: [
        { attachmentKeys: [`${FAMILY_ACTOR.id}/support-cases/valid.png`] },
      ],
    });
    await expect(
      service.downloadAttachment(
        FAMILY_ACTOR,
        CASE_ID,
        `${FAMILY_ACTOR.id}/support-cases/other.png`,
      ),
    ).rejects.toThrow(NotFoundException);

    const downloaded = await service.downloadAttachment(
      FAMILY_ACTOR,
      CASE_ID,
      `${FAMILY_ACTOR.id}/support-cases/valid.png`,
    );
    expect(downloaded.mimeType).toBe('image/png');
  });
});
