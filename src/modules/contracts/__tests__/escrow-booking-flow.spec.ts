import { ConflictException, BadRequestException } from '@nestjs/common';
import { ContractsServiceImpl } from '../services/impl/contracts.service.impl';

describe('Escrow Four-Step Booking Flow (Preview PDF, Credit Transfer, Refund, SLA 24h)', () => {
  it('previewFourPartyDraftPdf() gọi renderPdf với isDraftPreview=true và không tạo hợp đồng trong DB', async () => {
    const pdfBuffer = Buffer.from('%PDF-1.4 mock draft');
    const pdfRendererMock = { renderPdf: jest.fn().mockResolvedValue(pdfBuffer) };
    const sessionMock = {
      findFamilyById: jest.fn().mockResolvedValue({
        id: 'fam-1',
        address: 'Hà Nội',
        representativeUser: { fullName: 'Bùi Hoài Anh', email: 'ha@mail.com', phone: '0987654321' },
      }),
      findPackage: jest.fn().mockResolvedValue({
        id: 'pkg-1',
        packageName: 'Đồng hành 124',
        packageCode: 'DH124',
        durationMonths: 1,
        includedMembers: 3,
        periodicVisitsQuota: 15,
        telehealthQuota: 15,
        basePrice: 150000,
        additionalMemberMonthlyPrice: 50000,
      }),
      findDoctorById: jest.fn().mockResolvedValue({
        id: 'doc-1',
        doctorName: 'BS. CKI Đinh Văn Thắng',
        facilityId: 'fac-1',
      }),
      findFacilityById: jest.fn().mockResolvedValue({
        id: 'fac-1',
        facilityName: 'Bệnh viện Chợ Rẫy',
      }),
      findFirstActiveAdminUser: jest.fn().mockResolvedValue({
        fullName: 'Admin FamiDoc',
        email: 'admin@famidoc.vn',
      }),
      createMedicalContract: jest.fn(),
    };
    const repoMock = {
      transaction: jest.fn((cb: (s: any) => any) => cb(sessionMock)),
    };

    const service = new ContractsServiceImpl(
      repoMock as any,
      undefined,
      undefined,
      undefined,
      undefined,
      pdfRendererMock as any,
    );

    const result = await service.previewFourPartyDraftPdf(
      { id: 'u-1', role: 'FAMILY_REP', familyUnitId: 'fam-1' } as any,
      {
        packageId: 'pkg-1',
        doctorId: 'doc-1',
        memberCount: 3,
        homeVisitAddress: 'Số 12, Phố ABC, Hà Nội',
      } as any,
    );

    expect(result).toEqual(pdfBuffer);
    expect(pdfRendererMock.renderPdf).toHaveBeenCalledTimes(1);
    expect(pdfRendererMock.renderPdf.mock.calls[0][0]).toContain('BẢN NHÁP');
    expect(sessionMock.createMedicalContract).not.toHaveBeenCalled();
  });

  it('replaceDoctorWithCredit() ném 409 Conflict khi hợp đồng nguồn đã dùng tiền cho hợp đồng thay thế khác (double-spend)', async () => {
    const prismaMock = {
      medicalContract: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'src-1',
          contractStatus: 'APPROVAL_REJECTED',
          creditTransferTarget: { id: 'target-already-exists' },
          refundRequest: null,
        }),
      },
    };
    const service = new ContractsServiceImpl({ prisma: prismaMock } as any);

    await expect(
      service.replaceDoctorWithCredit(
        { id: 'u-1', role: 'FAMILY_REP' } as any,
        'src-1',
        'doc-2',
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('createRefundRequest() tạo yêu cầu hoàn 100% và chặn nếu thiếu thông tin hoặc đã bảo lưu đổi BS', async () => {
    const createdRefund = {
      id: 'rf-1',
      refundCode: 'RF-12345678',
      contractId: 'src-1',
      amountVnd: 150000,
      status: 'PENDING',
    };
    const txMock = {
      medicalContract: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'src-1',
          contractStatus: 'APPROVAL_EXPIRED',
          totalAmount: 150000,
          creditTransferTarget: null,
          refundRequest: null,
        }),
      },
      contractRefundRequest: {
        create: jest.fn().mockResolvedValue(createdRefund),
      },
    };
    const prismaMock = {
      $transaction: jest.fn((cb: (tx: any) => any) => cb(txMock)),
    };
    const service = new ContractsServiceImpl({ prisma: prismaMock } as any);

    await expect(
      service.createRefundRequest(
        { id: 'u-1', role: 'FAMILY_REP' } as any,
        'src-1',
        { bankName: '', accountNumber: '123', accountHolder: 'ANH' },
      ),
    ).rejects.toThrow(BadRequestException);

    const result = await service.createRefundRequest(
      { id: 'u-1', role: 'FAMILY_REP' } as any,
      'src-1',
      {
        bankName: 'Vietcombank',
        accountNumber: '0011001234567',
        accountHolder: 'bui hoai anh',
      },
    );
    expect(result.status).toBe('PENDING');
    expect(txMock.contractRefundRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          amountVnd: 150000,
          accountHolder: 'BUI HOAI ANH',
        }),
      }),
    );
  });

  it('expireOverdueEscrowApprovals() tự động chuyển các hợp đồng quá hạn 24h sang APPROVAL_EXPIRED', async () => {
    const documensoClientMock = {
      deleteEnvelope: jest.fn().mockResolvedValue(undefined),
    };
    const prismaMock = {
      medicalContract: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'ctr-overdue-1', documensoEnvelopeId: 'env-1' },
        ]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const service = new ContractsServiceImpl(
      { prisma: prismaMock } as any,
      undefined,
      undefined,
      documensoClientMock as any,
    );

    const count = await service.expireOverdueEscrowApprovals();
    expect(count).toBe(1);
    expect(prismaMock.medicalContract.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'ctr-overdue-1',
          contractStatus: 'PAID_PENDING_APPROVAL',
          platformSignRetryPending: false,
        }),
        data: expect.objectContaining({
          contractStatus: 'APPROVAL_EXPIRED',
        }),
      }),
    );
    expect(documensoClientMock.deleteEnvelope).toHaveBeenCalledWith('env-1');
  });
});
