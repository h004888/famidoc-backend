import { ContractsServiceImpl } from '../services/impl/contracts.service.impl';
import type { AuthenticatedUser } from '../../../core/auth/authenticated-request';
import { calculateContractTermsHash } from '../pricing/contract-terms-hash';

describe('ContractsServiceImpl - email thông báo thanh toán (4 bên)', () => {
  let sessionMock: any;
  let repositoryMock: any;
  let paymentNoticeMock: { sendPaymentNotice: jest.Mock };
  let service: ContractsServiceImpl;

  const familyRepUser: AuthenticatedUser = {
    id: 'user-rep-1',
    role: 'FAMILY_REP',
    familyUnitId: 'fam-uuid-1',
  };

  const doctorUser: AuthenticatedUser = {
    id: 'doctor-user-1',
    role: 'DOCTOR',
    familyUnitId: null,
  };

  const mockContract: any = {
    id: 'contract-uuid-1',
    contractNumber: 'MC2026TEST01',
    familyId: 'fam-uuid-1',
    facilityId: 'fac-1',
    doctorId: 'doc-1',
    packageId: 'pkg-1',
    totalAmount: '12000000',
    startDate: new Date('2026-01-01'),
    endDate: new Date('2027-01-01'),
    contractStatus: 'PENDING_APPROVAL',
    memberCount: 4,
    isDemo: false,
    upgradedFromId: null,
    billingSnapshot: {},
    familyUnit: { representativeUserId: 'user-rep-1' },
    facility: { userId: 'facility-user-1' },
    doctor: { userId: 'doctor-user-1' },
    servicePackage: { packageName: 'Gói Tiêu Chuẩn' },
  };

  const signDto = () => ({
    acceptedTerms: true,
    termsHash: calculateContractTermsHash(mockContract),
  });

  beforeEach(() => {
    sessionMock = {
      findContractForUpdate: jest.fn().mockResolvedValue(mockContract),
      findContractSignatures: jest.fn().mockResolvedValue([]),
      saveSignature: jest.fn().mockImplementation((data) => ({
        id: 'sig-1',
        ...data,
        createdAt: new Date(),
      })),
      updateContractStatus: jest.fn().mockResolvedValue(undefined),
      recordChange: jest.fn().mockResolvedValue(undefined),
    };
    repositoryMock = {
      transaction: jest.fn().mockImplementation(async (cb) => cb(sessionMock)),
    };
    paymentNoticeMock = { sendPaymentNotice: jest.fn().mockResolvedValue(undefined) };
    service = new ContractsServiceImpl(
      repositoryMock,
      undefined,
      paymentNoticeMock as any,
    );
  });

  it('gửi thông báo đúng một lần khi chữ ký thứ tư hoàn tất', async () => {
    sessionMock.findContractSignatures.mockResolvedValue([
      { signerRole: 'FAMILY_REP', signerUserId: 'user-rep-1' },
      { signerRole: 'ADMIN', signerUserId: 'admin-uuid-1' },
      { signerRole: 'HEALTHCARE_FACILITY', signerUserId: 'facility-user-1' },
    ]);

    const result = await service.signInitialMedicalContract(
      doctorUser,
      'contract-uuid-1',
      signDto(),
      '127.0.0.1',
    );

    expect(result.signerRole).toBe('ASSIGNED_DOCTOR');
    expect(sessionMock.updateContractStatus).toHaveBeenCalledWith(
      'contract-uuid-1',
      'PENDING_PAYMENT',
    );
    expect(paymentNoticeMock.sendPaymentNotice).toHaveBeenCalledTimes(1);
    expect(paymentNoticeMock.sendPaymentNotice).toHaveBeenCalledWith(
      'contract-uuid-1',
    );
  });

  it('không gửi thông báo với chữ ký đầu tiên', async () => {
    await service.signInitialMedicalContract(
      familyRepUser,
      'contract-uuid-1',
      signDto(),
      '127.0.0.1',
    );

    expect(paymentNoticeMock.sendPaymentNotice).not.toHaveBeenCalled();
  });

  it('không gửi thông báo khi cùng vai trò gửi lại yêu cầu ký', async () => {
    sessionMock.findContractSignatures.mockResolvedValue([
      { signerRole: 'FAMILY_REP', signerUserId: 'user-rep-1' },
      { signerRole: 'ADMIN', signerUserId: 'admin-uuid-1' },
      { signerRole: 'HEALTHCARE_FACILITY', signerUserId: 'facility-user-1' },
      { signerRole: 'ASSIGNED_DOCTOR', signerUserId: 'doctor-user-1' },
    ]);

    const result = await service.signInitialMedicalContract(
      doctorUser,
      'contract-uuid-1',
      signDto(),
      '127.0.0.1',
    );

    expect(result.signerRole).toBe('ASSIGNED_DOCTOR');
    expect(paymentNoticeMock.sendPaymentNotice).not.toHaveBeenCalled();
  });

  it('chữ ký vẫn thành công khi dịch vụ thông báo ném lỗi', async () => {
    sessionMock.findContractSignatures.mockResolvedValue([
      { signerRole: 'FAMILY_REP', signerUserId: 'user-rep-1' },
      { signerRole: 'ADMIN', signerUserId: 'admin-uuid-1' },
      { signerRole: 'HEALTHCARE_FACILITY', signerUserId: 'facility-user-1' },
    ]);
    paymentNoticeMock.sendPaymentNotice.mockRejectedValue(
      new Error('SMTP down'),
    );

    const result = await service.signInitialMedicalContract(
      doctorUser,
      'contract-uuid-1',
      signDto(),
      '127.0.0.1',
    );

    expect(result.signerRole).toBe('ASSIGNED_DOCTOR');
    expect(sessionMock.updateContractStatus).toHaveBeenCalledWith(
      'contract-uuid-1',
      'PENDING_PAYMENT',
    );
  });
});
