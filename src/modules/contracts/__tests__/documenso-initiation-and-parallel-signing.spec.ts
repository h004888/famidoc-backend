import { ValidationPipe, ConflictException, ServiceUnavailableException, NotFoundException, BadRequestException } from '@nestjs/common';
import { ContractsServiceImpl } from '../services/impl/contracts.service.impl';
import { CreateMedicalContractDto } from '../dtos/create-medical-contract.dto';
import type { AuthenticatedUser } from '../../../core/auth/authenticated-request';
import { calculateContractTermsHash } from '../pricing/contract-terms-hash';

describe('Documenso Contract Initiation, Parallel Signing, Signed PDF & Family Gate', () => {
  const familyUser: AuthenticatedUser = {
    id: 'user-family-1',
    role: 'FAMILY_REP',
    familyUnitId: 'fam-1',
  };
  const adminUser: AuthenticatedUser = {
    id: 'user-admin-1',
    role: 'ADMIN',
    familyUnitId: null,
  };
  const facilityUser: AuthenticatedUser = {
    id: 'user-fac-1',
    role: 'HEALTHCARE_FACILITY',
    familyUnitId: null,
  };
  const doctorUser: AuthenticatedUser = {
    id: 'user-doc-1',
    role: 'DOCTOR',
    familyUnitId: null,
  };

  const mockPkg = {
    id: '11111111-1111-4111-8111-111111111111',
    lineageCode: 'PKG-GOLD',
    version: 1,
    packageName: 'Gói Chăm Sóc Toàn Diện',
    description: 'Chăm sóc gia đình',
    durationMonths: 12,
    basePrice: '6000000',
    includedMembers: 2,
    maxMembers: 5,
    additionalMemberMonthlyPrice: '100000',
    quotaPeriod: 'CONTRACT_YEAR',
    periodicVisitsQuota: 12,
    telehealthQuota: 24,
    status: 'ACTIVE',
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    publishedAt: new Date(),
  };

  const mockFacility = {
    id: '22222222-2222-4222-8222-222222222222',
    userId: 'user-fac-1',
    facilityName: 'Phòng khám Medsev',
    verificationStatus: 'ACTIVE',
    user: { id: 'user-fac-1', email: 'fac@medsev.vn', fullName: 'Medsev' },
  };

  const mockDoctor = {
    id: '33333333-3333-4333-8333-333333333333',
    userId: 'user-doc-1',
    facilityId: '22222222-2222-4222-8222-222222222222',
    doctorName: 'BS. Lê Hoàng Nam',
    onboardingStatus: 'ACTIVE',
    maxPanelCapacity: 30,
    activePanelCount: 5,
    user: { id: 'user-doc-1', email: 'doc@medsev.vn', fullName: 'BS. Lê Hoàng Nam' },
  };

  const mockFamily = {
    id: 'fam-1',
    familyCode: 'FAM-001',
    representativeUserId: 'user-family-1',
    homeAddress: '123 Đường Láng, Phường Láng Thượng, Thành phố Hà Nội',
    status: 'ACTIVE',
    representativeUser: {
      id: 'user-family-1',
      email: 'family@example.com',
      fullName: 'Nguyễn Văn A',
    },
  };

  function makeContractRecord(overrides: Record<string, any> = {}) {
    return {
      id: 'contract-1',
      contractNumber: 'MC-DOCUMENSO-01',
      familyId: 'fam-1',
      facilityId: mockFacility.id,
      doctorId: mockDoctor.id,
      packageId: mockPkg.id,
      totalAmount: '8400000',
      remainingHomeVisits: 12,
      remainingTelehealth: 24,
      startDate: new Date('2026-11-13'),
      endDate: new Date('2027-11-13'),
      contractStatus: 'PENDING_APPROVAL',
      upgradedFromId: null,
      memberCount: 4,
      isDemo: false,
      billingSnapshot: {},
      documensoEnvelopeId: 'envelope_1',
      documensoItemId: 'item_1',
      familyUnit: mockFamily,
      facility: mockFacility,
      doctor: mockDoctor,
      servicePackage: mockPkg,
      ...overrides,
    };
  }

  describe('CreateMedicalContractDto ValidationPipe', () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    });

    it('chấp nhận payload chỉ có memberCount mà không cần patientIds', async () => {
      const parsed = await pipe.transform(
        {
          packageId: mockPkg.id,
          facilityId: mockFacility.id,
          doctorId: mockDoctor.id,
          memberCount: 4,
          homeVisitAddress: 'Số 12, Phố ABC, Quận XYZ, Hà Nội',
          additionalTerms: 'Ưu tiên lịch khám cuối tuần',
        },
        { type: 'body', metatype: CreateMedicalContractDto },
      );

      expect(parsed.memberCount).toBe(4);
      expect(parsed.patientIds).toBeUndefined();
      expect(parsed.additionalTerms).toBe('Ưu tiên lịch khám cuối tuần');
    });

    it('từ chối memberCount < 1, số thập phân hoặc patientIds trùng lặp', async () => {
      await expect(
        pipe.transform(
          {
            packageId: mockPkg.id,
            facilityId: mockFacility.id,
            memberCount: 0,
          },
          { type: 'body', metatype: CreateMedicalContractDto },
        ),
      ).rejects.toThrow();

      await expect(
        pipe.transform(
          {
            packageId: mockPkg.id,
            facilityId: mockFacility.id,
            memberCount: 2.5,
          },
          { type: 'body', metatype: CreateMedicalContractDto },
        ),
      ).rejects.toThrow();

      await expect(
        pipe.transform(
          {
            packageId: mockPkg.id,
            facilityId: mockFacility.id,
            patientIds: [mockPkg.id, mockPkg.id],
          },
          { type: 'body', metatype: CreateMedicalContractDto },
        ),
      ).rejects.toThrow();
    });
  });

  describe('createInitialMedicalContract with Documenso (no patientIds)', () => {
    it('render PDF động, tạo Envelope trên Documenso và trả signingToken/signingUrl cho Bên A', async () => {
      const savedSigners: any[] = [];
      const createdContracts: any[] = [];
      const sessionMock: any = {
        findPackage: jest.fn().mockResolvedValue(mockPkg),
        findFacilityById: jest.fn().mockResolvedValue(mockFacility),
        findActiveStaffingContract: jest.fn().mockImplementation((facilityId: string) =>
          Promise.resolve(
            facilityId === mockFacility.id
              ? { id: 'staffing-1', facilityId, status: 'ACTIVE' }
              : null,
          )
        ),
        findDoctorById: jest.fn().mockResolvedValue(mockDoctor),
        findFamilyById: jest.fn().mockResolvedValue(mockFamily),
        findFirstActiveAdminUser: jest
          .fn()
          .mockResolvedValue({ id: 'user-admin-1', email: 'admin@famidoc.online', fullName: 'Admin' }),
        createMedicalContract: jest.fn().mockImplementation(async (data) => {
          const rec = makeContractRecord(data);
          createdContracts.push(rec);
          return rec;
        }),
        saveDocumensoSigners: jest.fn().mockImplementation(async (rows) => {
          savedSigners.push(...rows);
        }),
        createContractMembers: jest.fn(),
        recordChange: jest.fn(),
      };
      const repoMock = {
        transaction: jest.fn().mockImplementation(async (cb) => cb(sessionMock)),
      };
      const pdfRendererMock = {
        renderPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 mock')),
      };
      const documensoMock = {
        createFourPartyEnvelope: jest.fn().mockResolvedValue({
          envelopeId: 'envelope_999',
          envelopeItemId: 'item_999',
          signers: [
            { role: 'FAMILY_REP', recipientId: 1, token: 'tok-a', signingUrl: 'https://sign.famidoc.online/sign/tok-a', status: 'NOT_SIGNED', completedAt: null },
            { role: 'HEALTHCARE_FACILITY', recipientId: 2, token: 'tok-b', signingUrl: 'https://sign.famidoc.online/sign/tok-b', status: 'NOT_SIGNED', completedAt: null },
            { role: 'ASSIGNED_DOCTOR', recipientId: 3, token: 'tok-c', signingUrl: 'https://sign.famidoc.online/sign/tok-c', status: 'NOT_SIGNED', completedAt: null },
            { role: 'ADMIN', recipientId: 4, token: 'tok-d', signingUrl: 'https://sign.famidoc.online/sign/tok-d', status: 'NOT_SIGNED', completedAt: null },
          ],
        }),
      };

      const service = new ContractsServiceImpl(
        repoMock as any,
        undefined,
        undefined,
        documensoMock as any,
        undefined,
        pdfRendererMock as any,
      );

      const summary = await service.createInitialMedicalContract(familyUser, {
        packageId: mockPkg.id,
        facilityId: mockFacility.id,
        doctorId: mockDoctor.id,
        memberCount: 4,
        additionalTerms: 'Miễn phụ thu tái khám tuần đầu',
      });

      expect(pdfRendererMock.renderPdf).toHaveBeenCalledTimes(1);
      expect(documensoMock.createFourPartyEnvelope).toHaveBeenCalledTimes(1);
      expect(sessionMock.createContractMembers).not.toHaveBeenCalled();
      expect(savedSigners).toHaveLength(4);
      expect(summary.memberCount).toBe(4);
      expect(summary.documensoEnvelopeId).toBe('envelope_999');
      expect(summary.documensoItemId).toBe('item_999');
      expect(summary.signingToken).toBe('tok-a');
      expect(summary.signingUrl).toBe('https://sign.famidoc.online/sign/tok-a');
      expect(summary.additionalTerms).toBe('Miễn phụ thu tái khám tuần đầu');
    });

    it('không tạo hợp đồng mồ côi khi Documenso bị lỗi', async () => {
      const sessionMock: any = {
        findPackage: jest.fn().mockResolvedValue(mockPkg),
        findFacilityById: jest.fn().mockResolvedValue(mockFacility),
        findActiveStaffingContract: jest.fn().mockImplementation((facilityId: string) =>
          Promise.resolve(
            facilityId === mockFacility.id
              ? { id: 'staffing-1', facilityId, status: 'ACTIVE' }
              : null,
          )
        ),
        findDoctorById: jest.fn().mockResolvedValue(mockDoctor),
        findFamilyById: jest.fn().mockResolvedValue(mockFamily),
        findFirstActiveAdminUser: jest.fn().mockResolvedValue(null),
        createMedicalContract: jest.fn(),
      };
      const repoMock = {
        transaction: jest.fn().mockImplementation(async (cb) => cb(sessionMock)),
      };
      const pdfRendererMock = {
        renderPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 mock')),
      };
      const documensoMock = {
        createFourPartyEnvelope: jest
          .fn()
          .mockRejectedValue(new ServiceUnavailableException('Documenso down')),
      };

      const service = new ContractsServiceImpl(
        repoMock as any,
        undefined,
        undefined,
        documensoMock as any,
        undefined,
        pdfRendererMock as any,
      );

      await expect(
        service.createInitialMedicalContract(familyUser, {
          packageId: mockPkg.id,
          facilityId: mockFacility.id,
          doctorId: mockDoctor.id,
          memberCount: 2,
        }),
      ).rejects.toThrow(ServiceUnavailableException);

      expect(sessionMock.createMedicalContract).not.toHaveBeenCalled();
    });

    it('tự động gọi deleteEnvelope để rollback Envelope Documenso khi lưu DB thất bại', async () => {
      const sessionMock: any = {
        findPackage: jest.fn().mockResolvedValue(mockPkg),
        findFacilityById: jest.fn().mockResolvedValue(mockFacility),
        findActiveStaffingContract: jest.fn().mockImplementation((facilityId: string) =>
          Promise.resolve(
            facilityId === mockFacility.id
              ? { id: 'staffing-1', facilityId, status: 'ACTIVE' }
              : null,
          )
        ),
        findDoctorById: jest.fn().mockResolvedValue(mockDoctor),
        findFamilyById: jest.fn().mockResolvedValue(mockFamily),
        findFirstActiveAdminUser: jest
          .fn()
          .mockResolvedValue({ id: 'user-admin-1', email: 'admin@famidoc.online', fullName: 'Admin' }),
        createMedicalContract: jest
          .fn()
          .mockRejectedValue(new Error('DB unique constraint error')),
      };
      const repoMock = {
        transaction: jest.fn().mockImplementation(async (cb) => cb(sessionMock)),
      };
      const pdfRendererMock = {
        renderPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 mock')),
      };
      const documensoMock = {
        createFourPartyEnvelope: jest.fn().mockResolvedValue({
          envelopeId: 'envelope_rollback_db_fail',
          envelopeItemId: 'item_rollback_db_fail',
          signers: [
            { role: 'FAMILY_REP', recipientId: 1, token: 'tok-a', signingUrl: 'https://sign.famidoc.online/sign/tok-a', status: 'NOT_SIGNED', completedAt: null },
            { role: 'HEALTHCARE_FACILITY', recipientId: 2, token: 'tok-b', signingUrl: 'https://sign.famidoc.online/sign/tok-b', status: 'NOT_SIGNED', completedAt: null },
            { role: 'ASSIGNED_DOCTOR', recipientId: 3, token: 'tok-c', signingUrl: 'https://sign.famidoc.online/sign/tok-c', status: 'NOT_SIGNED', completedAt: null },
            { role: 'ADMIN', recipientId: 4, token: 'tok-d', signingUrl: 'https://sign.famidoc.online/sign/tok-d', status: 'NOT_SIGNED', completedAt: null },
          ],
        }),
        deleteEnvelope: jest.fn().mockResolvedValue(undefined),
      };

      const service = new ContractsServiceImpl(
        repoMock as any,
        undefined,
        undefined,
        documensoMock as any,
        undefined,
        pdfRendererMock as any,
      );

      await expect(
        service.createInitialMedicalContract(familyUser, {
          packageId: mockPkg.id,
          facilityId: mockFacility.id,
          doctorId: mockDoctor.id,
          memberCount: 2,
        }),
      ).rejects.toThrow('DB unique constraint error');

      expect(documensoMock.deleteEnvelope).toHaveBeenCalledTimes(1);
      expect(documensoMock.deleteEnvelope).toHaveBeenCalledWith(
        'envelope_rollback_db_fail',
      );
    });
  });

  describe('Guard chặn dữ liệu demo (DEMO / .invalid) theo cờ môi trường', () => {
    const demoAdmin = {
      id: 'user-admin-demo',
      email: 'admin@demo.famidoc.invalid',
      fullName: 'DEMO - Quản trị viên',
    };

    function buildDemoSessionAndService() {
      const sessionMock: any = {
        findPackage: jest.fn().mockResolvedValue(mockPkg),
        findFacilityById: jest.fn().mockResolvedValue(mockFacility),
        findActiveStaffingContract: jest.fn().mockImplementation((facilityId: string) =>
          Promise.resolve(
            facilityId === mockFacility.id
              ? { id: 'staffing-1', facilityId, status: 'ACTIVE' }
              : null,
          )
        ),
        findDoctorById: jest.fn().mockResolvedValue(mockDoctor),
        findFamilyById: jest.fn().mockResolvedValue(mockFamily),
        findFirstActiveAdminUser: jest.fn().mockResolvedValue(demoAdmin),
        createMedicalContract: jest.fn().mockImplementation(async (data) =>
          makeContractRecord(data),
        ),
        saveDocumensoSigners: jest.fn().mockResolvedValue(undefined),
        createContractMembers: jest.fn(),
        recordChange: jest.fn(),
      };
      const repoMock = {
        transaction: jest.fn().mockImplementation(async (cb) => cb(sessionMock)),
      };
      const pdfRendererMock = {
        renderPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 mock')),
      };
      const documensoMock = {
        createFourPartyEnvelope: jest.fn().mockResolvedValue({
          envelopeId: 'envelope_demo',
          envelopeItemId: 'item_demo',
          signers: [
            { role: 'FAMILY_REP', recipientId: 1, token: 'tok-a', signingUrl: 'https://sign.famidoc.online/sign/tok-a', status: 'NOT_SIGNED', completedAt: null },
            { role: 'HEALTHCARE_FACILITY', recipientId: 2, token: 'tok-b', signingUrl: 'https://sign.famidoc.online/sign/tok-b', status: 'NOT_SIGNED', completedAt: null },
            { role: 'ASSIGNED_DOCTOR', recipientId: 3, token: 'tok-c', signingUrl: 'https://sign.famidoc.online/sign/tok-c', status: 'NOT_SIGNED', completedAt: null },
            { role: 'ADMIN', recipientId: 4, token: 'tok-d', signingUrl: 'https://sign.famidoc.online/sign/tok-d', status: 'NOT_SIGNED', completedAt: null },
          ],
        }),
      };
      const service = new ContractsServiceImpl(
        repoMock as any,
        undefined,
        undefined,
        documensoMock as any,
        undefined,
        pdfRendererMock as any,
      );
      return { sessionMock, pdfRendererMock, documensoMock, service };
    }

    const createContractPayload = {
      packageId: mockPkg.id,
      facilityId: mockFacility.id,
      doctorId: mockDoctor.id,
      memberCount: 2,
    };

    it('bật strict mode: chặn HTTP 400 khi thông tin các bên chứa DEMO/.invalid, không render PDF hay gọi Documenso', async () => {
      const prevFlag = process.env.CONTRACT_STRICT_REAL_PARTIES;
      process.env.CONTRACT_STRICT_REAL_PARTIES = 'true';
      try {
        const { sessionMock, pdfRendererMock, documensoMock, service } =
          buildDemoSessionAndService();

        await expect(
          service.createInitialMedicalContract(familyUser, createContractPayload),
        ).rejects.toThrow(BadRequestException);

        await expect(
          service.createInitialMedicalContract(familyUser, createContractPayload),
        ).rejects.toThrow(/DEMO|\.invalid|thử nghiệm/);

        expect(pdfRendererMock.renderPdf).not.toHaveBeenCalled();
        expect(documensoMock.createFourPartyEnvelope).not.toHaveBeenCalled();
        expect(sessionMock.createMedicalContract).not.toHaveBeenCalled();
      } finally {
        if (prevFlag === undefined) {
          delete process.env.CONTRACT_STRICT_REAL_PARTIES;
        } else {
          process.env.CONTRACT_STRICT_REAL_PARTIES = prevFlag;
        }
      }
    });

    it('tắt strict mode: vẫn khởi tạo hợp đồng thành công ở dev/staging với dữ liệu seed demo', async () => {
      const prevFlag = process.env.CONTRACT_STRICT_REAL_PARTIES;
      delete process.env.CONTRACT_STRICT_REAL_PARTIES;
      try {
        const { pdfRendererMock, documensoMock, service } =
          buildDemoSessionAndService();

        const summary = await service.createInitialMedicalContract(
          familyUser,
          createContractPayload,
        );

        expect(pdfRendererMock.renderPdf).toHaveBeenCalledTimes(1);
        expect(documensoMock.createFourPartyEnvelope).toHaveBeenCalledTimes(1);
        expect(summary.documensoEnvelopeId).toBe('envelope_demo');
      } finally {
        if (prevFlag !== undefined) {
          process.env.CONTRACT_STRICT_REAL_PARTIES = prevFlag;
        }
      }
    });
  });

  describe('getSigningSession, parallel signing order & downloadSignedPdf', () => {
    it('chặn Bên B, C, D với HTTP 409 trước khi Bên A ký và mở khóa song song sau khi Bên A ký', async () => {
      const contract = makeContractRecord();
      const signatures: Array<{ signerRole: any; signerUserId: string }> = [];
      const documensoSigners = [
        { signerRole: 'FAMILY_REP', documensoToken: 'tok-a', documensoSigningUrl: 'https://sign.famidoc.online/sign/tok-a' },
        { signerRole: 'HEALTHCARE_FACILITY', documensoToken: 'tok-b', documensoSigningUrl: 'https://sign.famidoc.online/sign/tok-b' },
        { signerRole: 'ASSIGNED_DOCTOR', documensoToken: 'tok-c', documensoSigningUrl: 'https://sign.famidoc.online/sign/tok-c' },
        { signerRole: 'ADMIN', documensoToken: 'tok-d', documensoSigningUrl: 'https://sign.famidoc.online/sign/tok-d' },
      ];
      const sessionMock: any = {
        findContractForUpdate: jest.fn().mockResolvedValue(contract),
        findContractSignatures: jest.fn().mockImplementation(async () => [...signatures]),
        findDocumensoSigners: jest.fn().mockResolvedValue(documensoSigners),
        saveSignature: jest.fn().mockImplementation(async (data) => {
          signatures.push({ signerRole: data.signerRole, signerUserId: data.signerUserId });
          return { id: `sig-${signatures.length}`, ...data };
        }),
        updateContractStatus: jest.fn(),
        recordChange: jest.fn(),
      };
      const repoMock = {
        transaction: jest.fn().mockImplementation(async (cb) => cb(sessionMock)),
      };
      const service = new ContractsServiceImpl(repoMock as any);

      // Trước khi Bên A ký: cả Admin, Cơ sở y tế, Bác sĩ đều bị chặn 409
      await expect(service.getSigningSession(adminUser, contract.id)).rejects.toThrow(ConflictException);
      await expect(service.getSigningSession(facilityUser, contract.id)).rejects.toThrow(ConflictException);
      await expect(service.getSigningSession(doctorUser, contract.id)).rejects.toThrow(ConflictException);

      const familySession = await service.getSigningSession(familyUser, contract.id);
      expect(familySession.signingToken).toBe('tok-a');
      expect(familySession.signingUrl).toBe('https://sign.famidoc.online/sign/tok-a');
      // 0/4 chữ ký: chưa được trả URL PDF đã ký.
      expect(familySession.signedPdfUrl).toBeNull();

      // Bên A ký xong
      const hash = calculateContractTermsHash(contract);
      await service.signInitialMedicalContract(
        familyUser,
        contract.id,
        { acceptedTerms: true, termsHash: hash },
        '127.0.0.1',
      );

      // Sau khi Bên A ký: cả B, C, D mở khóa song song
      const docSession = await service.getSigningSession(doctorUser, contract.id);
      const facSession = await service.getSigningSession(facilityUser, contract.id);
      const admSession = await service.getSigningSession(adminUser, contract.id);

      expect(docSession.signingToken).toBe('tok-c');
      expect(facSession.signingToken).toBe('tok-b');
      expect(admSession.signingToken).toBe('tok-d');
      // 1/4 chữ ký: vẫn chưa có URL PDF đã ký.
      expect(docSession.signedPdfUrl).toBeNull();

      await service.signInitialMedicalContract(
        doctorUser,
        contract.id,
        { acceptedTerms: true, termsHash: hash },
        '127.0.0.1',
      );
      await service.signInitialMedicalContract(
        facilityUser,
        contract.id,
        { acceptedTerms: true, termsHash: hash },
        '127.0.0.1',
      );

      // 3/4 chữ ký: vẫn chưa có URL PDF đã ký.
      const sessionAtThreeOfFour = await service.getSigningSession(adminUser, contract.id);
      expect(sessionAtThreeOfFour.signedRoles).toHaveLength(3);
      expect(sessionAtThreeOfFour.signedPdfUrl).toBeNull();

      await service.signInitialMedicalContract(
        adminUser,
        contract.id,
        { acceptedTerms: true, termsHash: hash },
        '127.0.0.1',
      );

      expect(sessionMock.updateContractStatus).toHaveBeenCalledWith(contract.id, 'PENDING_PAYMENT');

      // 4/4 chữ ký: mở khóa URL PDF đã ký.
      const sessionAtFourOfFour = await service.getSigningSession(adminUser, contract.id);
      expect(sessionAtFourOfFour.signedRoles).toHaveLength(4);
      expect(sessionAtFourOfFour.signedPdfUrl).toBe(
        '/api/v1/contracts/medical/contract-1/signed-pdf',
      );
    });

    it('getSigningSession(): coi hợp đồng đã đủ điều kiện khi 3/4 chữ ký nhưng đã PENDING_PAYMENT', async () => {
      const contract = makeContractRecord({ contractStatus: 'PENDING_PAYMENT' });
      const sessionMock: any = {
        findContractForUpdate: jest.fn().mockResolvedValue(contract),
        findContractSignatures: jest.fn().mockResolvedValue([
          { signerRole: 'FAMILY_REP' },
          { signerRole: 'HEALTHCARE_FACILITY' },
          { signerRole: 'ASSIGNED_DOCTOR' },
        ]),
        findDocumensoSigners: jest.fn().mockResolvedValue([
          { signerRole: 'ADMIN', documensoToken: 'tok-d', documensoSigningUrl: 'https://sign.famidoc.online/sign/tok-d' },
        ]),
      };
      const repoMock = {
        transaction: jest.fn().mockImplementation(async (cb) => cb(sessionMock)),
      };
      const service = new ContractsServiceImpl(repoMock as any);

      const session = await service.getSigningSession(adminUser, contract.id);
      expect(session.signedRoles).toHaveLength(3);
      expect(session.signedPdfUrl).toBe(
        '/api/v1/contracts/medical/contract-1/signed-pdf',
      );
    });

    it('getSigningSession(): chặn cấp phiên ký mới khi hợp đồng PENDING_APPROVAL đã tới hoặc quá signingDeadlineAt', async () => {
      const contract = makeContractRecord({
        contractStatus: 'PENDING_APPROVAL',
        signingDeadlineAt: new Date(Date.now() - 1000),
      });
      const sessionMock: any = {
        findContractForUpdate: jest.fn().mockResolvedValue(contract),
      };
      const repoMock = {
        transaction: jest.fn().mockImplementation(async (cb) => cb(sessionMock)),
      };
      const service = new ContractsServiceImpl(repoMock as any);

      await expect(
        service.getSigningSession(familyUser, contract.id),
      ).rejects.toThrow(ConflictException);
    });

    it('downloadSignedPdf(): báo 404 khi chưa có documensoItemId', async () => {
      const contractWithoutItem = makeContractRecord({ documensoItemId: null });
      const sessionMock: any = {
        findContractForUpdate: jest.fn().mockResolvedValue(contractWithoutItem),
        findContractSignatures: jest.fn().mockResolvedValue([
          { signerRole: 'FAMILY_REP' },
          { signerRole: 'HEALTHCARE_FACILITY' },
          { signerRole: 'ASSIGNED_DOCTOR' },
          { signerRole: 'ADMIN' },
        ]),
      };
      const repoMock = {
        transaction: jest.fn().mockImplementation(async (cb) => cb(sessionMock)),
      };
      const documensoMock = {
        downloadSignedItemPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-signed')),
      };

      const service = new ContractsServiceImpl(
        repoMock as any,
        undefined,
        undefined,
        documensoMock as any,
      );

      await expect(service.downloadSignedPdf(familyUser, 'contract-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(documensoMock.downloadSignedItemPdf).not.toHaveBeenCalled();
    });

    it.each([
      ['0/4', [] as string[]],
      ['1/4', ['FAMILY_REP']],
      ['2/4', ['FAMILY_REP', 'HEALTHCARE_FACILITY']],
      ['3/4', ['FAMILY_REP', 'HEALTHCARE_FACILITY', 'ASSIGNED_DOCTOR']],
    ])(
      'downloadSignedPdf(): ném 409 Conflict khi hợp đồng mới có %s chữ ký',
      async (_label, roles) => {
        const contract = makeContractRecord({ documensoItemId: 'item_signed_1' });
        const sessionMock: any = {
          findContractForUpdate: jest.fn().mockResolvedValue(contract),
          findContractSignatures: jest
            .fn()
            .mockResolvedValue(roles.map((signerRole) => ({ signerRole }))),
        };
        const repoMock = {
          transaction: jest.fn().mockImplementation(async (cb) => cb(sessionMock)),
        };
        const documensoMock = {
          downloadSignedItemPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-signed')),
        };

        const service = new ContractsServiceImpl(
          repoMock as any,
          undefined,
          undefined,
          documensoMock as any,
        );

        await expect(
          service.downloadSignedPdf(familyUser, 'contract-1'),
        ).rejects.toThrow(ConflictException);
        expect(documensoMock.downloadSignedItemPdf).not.toHaveBeenCalled();
      },
    );

    it('downloadSignedPdf(): tải PDF qua DocumensoClientService khi đã đủ 4/4 chữ ký', async () => {
      const contract = makeContractRecord({ documensoItemId: 'item_signed_1' });
      const sessionMock: any = {
        findContractForUpdate: jest.fn().mockResolvedValue(contract),
        findContractSignatures: jest.fn().mockResolvedValue([
          { signerRole: 'FAMILY_REP' },
          { signerRole: 'HEALTHCARE_FACILITY' },
          { signerRole: 'ASSIGNED_DOCTOR' },
          { signerRole: 'ADMIN' },
        ]),
      };
      const repoMock = {
        transaction: jest.fn().mockImplementation(async (cb) => cb(sessionMock)),
      };
      const documensoMock = {
        downloadSignedItemPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-signed')),
      };

      const service = new ContractsServiceImpl(
        repoMock as any,
        undefined,
        undefined,
        documensoMock as any,
      );

      const res = await service.downloadSignedPdf(familyUser, 'contract-1');
      expect(res.buffer.toString('ascii')).toBe('%PDF-signed');
      expect(res.filename).toBe('MC-DOCUMENSO-01-signed.pdf');
      expect(documensoMock.downloadSignedItemPdf).toHaveBeenCalledWith('item_signed_1');
    });

    it('downloadSignedPdf(): cho phép tải khi signatures chỉ 3 role nhưng trạng thái đã PENDING_PAYMENT', async () => {
      const contract = makeContractRecord({
        documensoItemId: 'item_signed_1',
        contractStatus: 'PENDING_PAYMENT',
      });
      const sessionMock: any = {
        findContractForUpdate: jest.fn().mockResolvedValue(contract),
        findContractSignatures: jest.fn().mockResolvedValue([
          { signerRole: 'FAMILY_REP' },
          { signerRole: 'HEALTHCARE_FACILITY' },
          { signerRole: 'ASSIGNED_DOCTOR' },
        ]),
      };
      const repoMock = {
        transaction: jest.fn().mockImplementation(async (cb) => cb(sessionMock)),
      };
      const documensoMock = {
        downloadSignedItemPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-signed')),
      };

      const service = new ContractsServiceImpl(
        repoMock as any,
        undefined,
        undefined,
        documensoMock as any,
      );

      const res = await service.downloadSignedPdf(familyUser, 'contract-1');
      expect(res.buffer.toString('ascii')).toBe('%PDF-signed');
      expect(documensoMock.downloadSignedItemPdf).toHaveBeenCalledWith('item_signed_1');
    });
  });

  describe('getFamilyGateStatus', () => {
    it('trả về hasActiveContract đúng theo trạng thái hợp đồng của hộ gia đình', async () => {
      const sessionMock: any = {
        findFamilyGateStatus: jest.fn().mockResolvedValue({
          activeContract: null,
          pendingContract: { id: 'c-pend', contractNumber: 'MC-1', contractStatus: 'PENDING_APPROVAL' },
          patientCount: 0,
        }),
      };
      const repoMock = {
        transaction: jest.fn().mockImplementation(async (cb) => cb(sessionMock)),
      };
      const service = new ContractsServiceImpl(repoMock as any);

      const gate = await service.getFamilyGateStatus(familyUser);
      expect(gate.hasActiveContract).toBe(false);
      expect(gate.pendingContract?.id).toBe('c-pend');
    });
  });

  describe('getSigningSession backfill (2B), lazy provision (1A), read-only 200 & upgrade Documenso', () => {
    it('backfill (2B): tìm đúng người ký theo email chuẩn hóa qua getEnvelope ngoài TX và trả HTTP 200', async () => {
      const contract = makeContractRecord({
        documensoEnvelopeId: 'env-backfill-1',
        documensoItemId: 'item-backfill-1',
      });
      const storedSigners: any[] = [
        { signerRole: 'FAMILY_REP', documensoToken: 'tok-a', documensoSigningUrl: 'https://sign.famidoc.online/sign/tok-a' },
      ];
      let insideTx = false;
      const sessionMock: any = {
        findContractForUpdate: jest.fn().mockResolvedValue(contract),
        findContractSignatures: jest.fn().mockResolvedValue([{ signerRole: 'FAMILY_REP' }]),
        findDocumensoSigners: jest.fn().mockImplementation(async () => [...storedSigners]),
        findFamilyById: jest.fn().mockResolvedValue(mockFamily),
        findFacilityById: jest.fn().mockResolvedValue(mockFacility),
        findDoctorById: jest.fn().mockResolvedValue(mockDoctor),
        findFirstActiveAdminUser: jest.fn().mockResolvedValue({
          id: 'user-admin-1',
          email: 'admin@famidoc.online',
          fullName: 'Admin',
        }),
        saveDocumensoSigners: jest.fn().mockImplementation(async (rows) => {
          storedSigners.push(...rows);
        }),
      };
      const repoMock = {
        transaction: jest.fn().mockImplementation(async (cb) => {
          insideTx = true;
          try {
            return await cb(sessionMock);
          } finally {
            insideTx = false;
          }
        }),
      };
      const documensoMock = {
        isConfigured: jest.fn().mockReturnValue(true),
        getBaseUrl: jest.fn().mockReturnValue('https://sign.famidoc.online'),
        getEnvelope: jest.fn().mockImplementation(async () => {
          expect(insideTx).toBe(false);
          return {
            id: 'env-backfill-1',
            status: 'PENDING',
            title: 'HD',
            envelopeItems: [{ id: 'item-backfill-1' }],
            recipients: [
              { id: 10, email: 'family@example.com', name: 'A', token: 'tok-a', signingStatus: 'SIGNED' },
              { id: 11, email: 'fac@medsev.vn', name: 'B', token: 'tok-b', signingStatus: 'NOT_SIGNED' },
              { id: 12, email: '  DOC@MEDSEV.VN ', name: 'C', token: 'tok-c-backfill', signingUrl: 'https://sign.famidoc.online/sign/tok-c-backfill', signingStatus: 'NOT_SIGNED' },
              { id: 13, email: 'admin@famidoc.online', name: 'D', token: 'tok-d', signingStatus: 'NOT_SIGNED' },
            ],
          };
        }),
      };

      const service = new ContractsServiceImpl(
        repoMock as any,
        undefined,
        undefined,
        documensoMock as any,
      );

      const session = await service.getSigningSession(doctorUser, contract.id);

      expect(documensoMock.getEnvelope).toHaveBeenCalledWith('env-backfill-1');
      expect(sessionMock.saveDocumensoSigners).toHaveBeenCalledTimes(1);
      expect(session.canSign).toBe(true);
      expect(session.signingToken).toBe('tok-c-backfill');
      expect(session.signingUrl).toBe('https://sign.famidoc.online/sign/tok-c-backfill');
    });

    it('backfill (2B): không fallback theo signingOrder và không chèn DB khi email không khớp -> ném 404', async () => {
      const contract = makeContractRecord({
        documensoEnvelopeId: 'env-mismatch-1',
        documensoItemId: 'item-mismatch-1',
      });
      const sessionMock: any = {
        findContractForUpdate: jest.fn().mockResolvedValue(contract),
        findContractSignatures: jest.fn().mockResolvedValue([]),
        findDocumensoSigners: jest.fn().mockResolvedValue([]),
        findFamilyById: jest.fn().mockResolvedValue(mockFamily),
        findFacilityById: jest.fn().mockResolvedValue(mockFacility),
        findDoctorById: jest.fn().mockResolvedValue(mockDoctor),
        findFirstActiveAdminUser: jest.fn().mockResolvedValue({
          id: 'user-admin-1',
          email: 'admin@famidoc.online',
          fullName: 'Admin',
        }),
        saveDocumensoSigners: jest.fn(),
      };
      const repoMock = {
        transaction: jest.fn().mockImplementation(async (cb) => cb(sessionMock)),
      };
      const documensoMock = {
        isConfigured: jest.fn().mockReturnValue(true),
        getBaseUrl: jest.fn().mockReturnValue('https://sign.famidoc.online'),
        getEnvelope: jest.fn().mockResolvedValue({
          id: 'env-mismatch-1',
          status: 'PENDING',
          title: 'HD',
          envelopeItems: [{ id: 'item-mismatch-1' }],
          recipients: [
            // signingOrder=1 nhưng email đã bị đổi
            { id: 10, email: 'changed-family@example.com', name: 'A', token: 'tok-wrong', signingOrder: 1, signingStatus: 'NOT_SIGNED' },
            { id: 11, email: 'fac@medsev.vn', name: 'B', token: 'tok-b', signingOrder: 2, signingStatus: 'NOT_SIGNED' },
            { id: 12, email: 'doc@medsev.vn', name: 'C', token: 'tok-c', signingOrder: 3, signingStatus: 'NOT_SIGNED' },
            { id: 13, email: 'admin@famidoc.online', name: 'D', token: 'tok-d', signingOrder: 4, signingStatus: 'NOT_SIGNED' },
          ],
        }),
      };

      const service = new ContractsServiceImpl(
        repoMock as any,
        undefined,
        undefined,
        documensoMock as any,
      );

      await expect(service.getSigningSession(familyUser, contract.id)).rejects.toThrow(
        NotFoundException,
      );
      expect(sessionMock.saveDocumensoSigners).not.toHaveBeenCalled();
    });

    it('lazy provision (1A): tạo Envelope ngoài TX, xóa chữ ký cũ documensoRecipientId IS NULL và giữ cổng 409 chờ Bên A', async () => {
      const contractState: any = makeContractRecord({
        documensoEnvelopeId: null,
        documensoItemId: null,
      });
      const storedSigners: any[] = [];
      const storedSignatures: any[] = [
        { id: 'legacy-1', signerRole: 'FAMILY_REP', documensoRecipientId: null },
      ];
      let insideTx = false;
      const sessionMock: any = {
        findContractForUpdate: jest.fn().mockImplementation(async () => ({ ...contractState })),
        findContractSignatures: jest.fn().mockImplementation(async () => [...storedSignatures]),
        findDocumensoSigners: jest.fn().mockImplementation(async () => [...storedSigners]),
        findFamilyById: jest.fn().mockResolvedValue(mockFamily),
        findFacilityById: jest.fn().mockResolvedValue(mockFacility),
        findDoctorById: jest.fn().mockResolvedValue(mockDoctor),
        findFirstActiveAdminUser: jest.fn().mockResolvedValue({
          id: 'user-admin-1',
          email: 'admin@famidoc.online',
          fullName: 'Admin',
        }),
        updateContractDocumensoEnvelope: jest
          .fn()
          .mockImplementation(async (_id: string, envId: string, itemId: string) => {
            if (contractState.documensoEnvelopeId !== null) return false;
            contractState.documensoEnvelopeId = envId;
            contractState.documensoItemId = itemId;
            return true;
          }),
        saveDocumensoSigners: jest.fn().mockImplementation(async (rows) => {
          storedSigners.push(...rows);
        }),
        clearLegacyNonDocumensoSignatures: jest.fn().mockImplementation(async () => {
          for (let i = storedSignatures.length - 1; i >= 0; i--) {
            if (storedSignatures[i].documensoRecipientId == null) {
              storedSignatures.splice(i, 1);
            }
          }
        }),
      };
      const repoMock = {
        transaction: jest.fn().mockImplementation(async (cb) => {
          insideTx = true;
          try {
            return await cb(sessionMock);
          } finally {
            insideTx = false;
          }
        }),
      };
      const pdfRendererMock = {
        renderPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 lazy')),
      };
      const documensoMock = {
        isConfigured: jest.fn().mockReturnValue(true),
        createFourPartyEnvelope: jest.fn().mockImplementation(async () => {
          expect(insideTx).toBe(false);
          return {
            envelopeId: 'env-lazy-1',
            envelopeItemId: 'item-lazy-1',
            signers: [
              { role: 'FAMILY_REP', recipientId: 1, token: 'tok-a-lazy', signingUrl: 'https://sign.famidoc.online/sign/tok-a-lazy', status: 'NOT_SIGNED', completedAt: null },
              { role: 'HEALTHCARE_FACILITY', recipientId: 2, token: 'tok-b-lazy', signingUrl: 'https://sign.famidoc.online/sign/tok-b-lazy', status: 'NOT_SIGNED', completedAt: null },
              { role: 'ASSIGNED_DOCTOR', recipientId: 3, token: 'tok-c-lazy', signingUrl: 'https://sign.famidoc.online/sign/tok-c-lazy', status: 'NOT_SIGNED', completedAt: null },
              { role: 'ADMIN', recipientId: 4, token: 'tok-d-lazy', signingUrl: 'https://sign.famidoc.online/sign/tok-d-lazy', status: 'NOT_SIGNED', completedAt: null },
            ],
          };
        }),
      };

      const service = new ContractsServiceImpl(
        repoMock as any,
        undefined,
        undefined,
        documensoMock as any,
        undefined,
        pdfRendererMock as any,
      );

      // Admin gọi trước: tạo envelope 1A, xóa legacy signature của Bên A, rồi bị chặn 409 vì Bên A chưa ký trên Documenso
      await expect(service.getSigningSession(adminUser, contractState.id)).rejects.toThrow(
        ConflictException,
      );
      expect(documensoMock.createFourPartyEnvelope).toHaveBeenCalledTimes(1);
      expect(sessionMock.clearLegacyNonDocumensoSignatures).toHaveBeenCalledWith(contractState.id);
      expect(storedSignatures).toHaveLength(0);
      expect(storedSigners).toHaveLength(4);

      // Bên A gọi lại: dùng đúng envelope vừa tạo, nhận token ký Documenso
      const familySession = await service.getSigningSession(familyUser, contractState.id);
      expect(documensoMock.createFourPartyEnvelope).toHaveBeenCalledTimes(1);
      expect(familySession.canSign).toBe(true);
      expect(familySession.signingToken).toBe('tok-a-lazy');
    });

    it('lazy provision (1A) đồng thời: chỉ lưu một documensoEnvelopeId và luồng thua gọi deleteEnvelope', async () => {
      const contractState: any = makeContractRecord({
        documensoEnvelopeId: null,
        documensoItemId: null,
      });
      const storedSigners: any[] = [];
      const sessionMock: any = {
        findContractForUpdate: jest.fn().mockImplementation(async () => ({ ...contractState })),
        findContractSignatures: jest.fn().mockResolvedValue([]),
        findDocumensoSigners: jest.fn().mockImplementation(async () => [...storedSigners]),
        findFamilyById: jest.fn().mockResolvedValue(mockFamily),
        findFacilityById: jest.fn().mockResolvedValue(mockFacility),
        findDoctorById: jest.fn().mockResolvedValue(mockDoctor),
        findFirstActiveAdminUser: jest.fn().mockResolvedValue({
          id: 'user-admin-1',
          email: 'admin@famidoc.online',
          fullName: 'Admin',
        }),
        updateContractDocumensoEnvelope: jest
          .fn()
          .mockImplementation(async (_id: string, envId: string, itemId: string) => {
            if (contractState.documensoEnvelopeId !== null) return false;
            contractState.documensoEnvelopeId = envId;
            contractState.documensoItemId = itemId;
            return true;
          }),
        saveDocumensoSigners: jest.fn().mockImplementation(async (rows) => {
          storedSigners.push(...rows);
        }),
        clearLegacyNonDocumensoSignatures: jest.fn(),
      };
      const repoMock = {
        transaction: jest.fn().mockImplementation(async (cb) => cb(sessionMock)),
      };
      const pdfRendererMock = {
        renderPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 race')),
      };

      // Đồng bộ hai luồng cùng hoàn tất tạo Envelope ngoài TX trước khi vào TX 2
      let firstReady!: () => void;
      let secondReady!: () => void;
      const barrier1 = new Promise<void>((r) => { firstReady = r; });
      const barrier2 = new Promise<void>((r) => { secondReady = r; });
      let callIndex = 0;

      const documensoMock = {
        isConfigured: jest.fn().mockReturnValue(true),
        createFourPartyEnvelope: jest.fn().mockImplementation(async () => {
          callIndex += 1;
          const idx = callIndex;
          if (idx === 1) {
            firstReady();
            await barrier2;
          } else {
            secondReady();
            await barrier1;
          }
          return {
            envelopeId: `env-race-${idx}`,
            envelopeItemId: `item-race-${idx}`,
            signers: [
              { role: 'FAMILY_REP', recipientId: idx * 10 + 1, token: `tok-a-${idx}`, signingUrl: `https://sign.famidoc.online/sign/tok-a-${idx}`, status: 'NOT_SIGNED', completedAt: null },
              { role: 'HEALTHCARE_FACILITY', recipientId: idx * 10 + 2, token: `tok-b-${idx}`, signingUrl: `https://sign.famidoc.online/sign/tok-b-${idx}`, status: 'NOT_SIGNED', completedAt: null },
              { role: 'ASSIGNED_DOCTOR', recipientId: idx * 10 + 3, token: `tok-c-${idx}`, signingUrl: `https://sign.famidoc.online/sign/tok-c-${idx}`, status: 'NOT_SIGNED', completedAt: null },
              { role: 'ADMIN', recipientId: idx * 10 + 4, token: `tok-d-${idx}`, signingUrl: `https://sign.famidoc.online/sign/tok-d-${idx}`, status: 'NOT_SIGNED', completedAt: null },
            ],
          };
        }),
        deleteEnvelope: jest.fn().mockResolvedValue(undefined),
      };

      const service = new ContractsServiceImpl(
        repoMock as any,
        undefined,
        undefined,
        documensoMock as any,
        undefined,
        pdfRendererMock as any,
      );

      const [res1, res2] = await Promise.all([
        service.getSigningSession(familyUser, contractState.id),
        service.getSigningSession(familyUser, contractState.id),
      ]);

      expect(contractState.documensoEnvelopeId).toBe('env-race-1');
      expect(documensoMock.deleteEnvelope).toHaveBeenCalledTimes(1);
      expect(documensoMock.deleteEnvelope).toHaveBeenCalledWith('env-race-2');
      expect(res1.signingToken).toBe('tok-a-1');
      expect(res2.signingToken).toBe('tok-a-1');
    });

    it('lazy provision (1A): gọi deleteEnvelope khi lưu DB thất bại', async () => {
      const contract = makeContractRecord({
        documensoEnvelopeId: null,
        documensoItemId: null,
      });
      const sessionMock: any = {
        findContractForUpdate: jest.fn().mockResolvedValue(contract),
        findContractSignatures: jest.fn().mockResolvedValue([]),
        findDocumensoSigners: jest.fn().mockResolvedValue([]),
        findFamilyById: jest.fn().mockResolvedValue(mockFamily),
        findFacilityById: jest.fn().mockResolvedValue(mockFacility),
        findDoctorById: jest.fn().mockResolvedValue(mockDoctor),
        findFirstActiveAdminUser: jest.fn().mockResolvedValue(null),
        updateContractDocumensoEnvelope: jest.fn().mockResolvedValue(true),
        saveDocumensoSigners: jest.fn().mockRejectedValue(new Error('DB write failure')),
      };
      const repoMock = {
        transaction: jest.fn().mockImplementation(async (cb) => cb(sessionMock)),
      };
      const pdfRendererMock = {
        renderPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4')),
      };
      const documensoMock = {
        isConfigured: jest.fn().mockReturnValue(true),
        createFourPartyEnvelope: jest.fn().mockResolvedValue({
          envelopeId: 'env-lazy-rollback',
          envelopeItemId: 'item-lazy-rollback',
          signers: [
            { role: 'FAMILY_REP', recipientId: 1, token: 'tok-a', signingUrl: 'https://sign.famidoc.online/sign/tok-a', status: 'NOT_SIGNED', completedAt: null },
            { role: 'HEALTHCARE_FACILITY', recipientId: 2, token: 'tok-b', signingUrl: 'https://sign.famidoc.online/sign/tok-b', status: 'NOT_SIGNED', completedAt: null },
            { role: 'ASSIGNED_DOCTOR', recipientId: 3, token: 'tok-c', signingUrl: 'https://sign.famidoc.online/sign/tok-c', status: 'NOT_SIGNED', completedAt: null },
            { role: 'ADMIN', recipientId: 4, token: 'tok-d', signingUrl: 'https://sign.famidoc.online/sign/tok-d', status: 'NOT_SIGNED', completedAt: null },
          ],
        }),
        deleteEnvelope: jest.fn().mockResolvedValue(undefined),
      };

      const service = new ContractsServiceImpl(
        repoMock as any,
        undefined,
        undefined,
        documensoMock as any,
        undefined,
        pdfRendererMock as any,
      );

      await expect(service.getSigningSession(familyUser, contract.id)).rejects.toThrow(
        'DB write failure',
      );
      expect(documensoMock.deleteEnvelope).toHaveBeenCalledWith('env-lazy-rollback');
    });

    it.each([
      {
        label: 'isDemo=true',
        actor: adminUser,
        overrides: { isDemo: true, documensoEnvelopeId: null, documensoItemId: null },
        signatures: [],
      },
      {
        label: 'alreadySigned=true',
        actor: familyUser,
        overrides: { contractStatus: 'PENDING_APPROVAL' },
        signatures: [{ signerRole: 'FAMILY_REP' }],
      },
      {
        label: 'PENDING_PAYMENT',
        actor: adminUser,
        overrides: { contractStatus: 'PENDING_PAYMENT', documensoEnvelopeId: null, documensoItemId: null },
        signatures: [],
      },
      {
        label: 'ACTIVE',
        actor: familyUser,
        overrides: { contractStatus: 'ACTIVE', documensoEnvelopeId: null, documensoItemId: null },
        signatures: [],
      },
      {
        label: 'TERMINATED',
        actor: familyUser,
        overrides: { contractStatus: 'TERMINATED', documensoEnvelopeId: null, documensoItemId: null },
        signatures: [],
      },
    ])(
      'getSigningSession(): trả HTTP 200 read-only { canSign: false, signingToken: null, signingUrl: null } cho $label khi thiếu signer row',
      async ({ actor, overrides, signatures }) => {
        const contract = makeContractRecord(overrides);
        const sessionMock: any = {
          findContractForUpdate: jest.fn().mockResolvedValue(contract),
          findContractSignatures: jest.fn().mockResolvedValue(signatures),
          findDocumensoSigners: jest.fn().mockResolvedValue([]),
        };
        const repoMock = {
          transaction: jest.fn().mockImplementation(async (cb) => cb(sessionMock)),
        };
        const documensoMock = {
          isConfigured: jest.fn().mockReturnValue(true),
          createFourPartyEnvelope: jest.fn(),
          getEnvelope: jest.fn(),
        };

        const service = new ContractsServiceImpl(
          repoMock as any,
          undefined,
          undefined,
          documensoMock as any,
        );

        const res = await service.getSigningSession(actor, contract.id);
        expect(res).toMatchObject({
          contractId: contract.id,
          canSign: false,
          signingToken: null,
          signingUrl: null,
        });
        expect(documensoMock.createFourPartyEnvelope).not.toHaveBeenCalled();
        expect(documensoMock.getEnvelope).not.toHaveBeenCalled();
      },
    );

    it('createPackageUpgradeContract(): từ chối kind UPGRADE (R6) và tạo gia hạn RENEWAL không ký lại Documenso 4 bên', async () => {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const oldContract = makeContractRecord({
        id: 'old-expired-1',
        contractStatus: 'EXPIRED',
        endDate: yesterday,
        billingSnapshot: {
          package: { code: 'PKG-GOLD', durationMonths: 3 },
          members: { requestedCount: 2 },
          pricing: { totalPriceVnd: 2_000_000 },
          benefits: { quotas: { videoConsultations: 6 } },
        },
      });
      const savedSigners: any[] = [];
      const sessionMock: any = {
        findContractForUpdate: jest.fn().mockResolvedValue(oldContract),
        findOpenUpgrade: jest.fn().mockResolvedValue(null),
        hasOtherActiveContract: jest.fn().mockResolvedValue(false),
        findPackage: jest.fn().mockResolvedValue(mockPkg),
        countFamilyMembers: jest.fn().mockResolvedValue(2),
        findFamilyById: jest.fn().mockResolvedValue(mockFamily),
        findFacilityById: jest.fn().mockResolvedValue(mockFacility),
        findDoctorById: jest.fn().mockResolvedValue(mockDoctor),
        findFirstActiveAdminUser: jest.fn().mockResolvedValue({
          id: 'user-admin-1',
          email: 'admin@famidoc.online',
          fullName: 'Admin',
        }),
        createUpgrade: jest.fn().mockImplementation(async (data) =>
          makeContractRecord({ id: 'upgrade-ctr-1', ...data }),
        ),
        saveDocumensoSigners: jest.fn().mockImplementation(async (rows) => {
          savedSigners.push(...rows);
        }),
        recordChange: jest.fn(),
      };
      const repoMock = {
        transaction: jest.fn().mockImplementation(async (cb) => cb(sessionMock)),
      };
      const pdfRendererMock = {
        renderPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 upgrade')),
      };
      const documensoMock = {
        isConfigured: jest.fn().mockReturnValue(true),
        createFourPartyEnvelope: jest.fn().mockResolvedValue({
          envelopeId: 'env-upgrade-1',
          envelopeItemId: 'item-upgrade-1',
          signers: [
            { role: 'FAMILY_REP', recipientId: 1, token: 'tok-up-a', signingUrl: 'https://sign.famidoc.online/sign/tok-up-a', status: 'NOT_SIGNED', completedAt: null },
            { role: 'HEALTHCARE_FACILITY', recipientId: 2, token: 'tok-up-b', signingUrl: 'https://sign.famidoc.online/sign/tok-up-b', status: 'NOT_SIGNED', completedAt: null },
            { role: 'ASSIGNED_DOCTOR', recipientId: 3, token: 'tok-up-c', signingUrl: 'https://sign.famidoc.online/sign/tok-up-c', status: 'NOT_SIGNED', completedAt: null },
            { role: 'ADMIN', recipientId: 4, token: 'tok-up-d', signingUrl: 'https://sign.famidoc.online/sign/tok-up-d', status: 'NOT_SIGNED', completedAt: null },
          ],
        }),
      };

      const service = new ContractsServiceImpl(
        repoMock as any,
        undefined,
        undefined,
        documensoMock as any,
        undefined,
        pdfRendererMock as any,
      );

      await expect(
        service.createPackageUpgradeContract(familyUser, oldContract.id, {
          packageId: mockPkg.id,
          kind: 'UPGRADE',
        }),
      ).rejects.toThrow(BadRequestException);

      const summary = await service.createPackageUpgradeContract(familyUser, oldContract.id, {
        packageId: mockPkg.id,
        kind: 'RENEWAL',
      });

      expect(documensoMock.createFourPartyEnvelope).not.toHaveBeenCalled();
      expect(savedSigners).toHaveLength(0);
      expect(summary.documensoEnvelopeId).toBeNull();
      expect(summary.documensoItemId).toBeNull();
      expect(summary.contractStatus).toBe('PENDING_PAYMENT');
    });

    it('createPackageUpgradeContract(): truyền lỗi DB khi createUpgrade thất bại và không tạo hay xóa Envelope Documenso', async () => {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const oldContract = makeContractRecord({
        id: 'old-expired-2',
        contractStatus: 'EXPIRED',
        endDate: yesterday,
        billingSnapshot: {
          package: { code: 'PKG-GOLD', durationMonths: 3 },
          members: { requestedCount: 2 },
          pricing: { totalPriceVnd: 2_000_000 },
          benefits: { quotas: { videoConsultations: 6 } },
        },
      });
      const sessionMock: any = {
        findContractForUpdate: jest.fn().mockResolvedValue(oldContract),
        findOpenUpgrade: jest.fn().mockResolvedValue(null),
        hasOtherActiveContract: jest.fn().mockResolvedValue(false),
        findPackage: jest.fn().mockResolvedValue(mockPkg),
        countFamilyMembers: jest.fn().mockResolvedValue(2),
        findFamilyById: jest.fn().mockResolvedValue(mockFamily),
        findFacilityById: jest.fn().mockResolvedValue(mockFacility),
        findDoctorById: jest.fn().mockResolvedValue(mockDoctor),
        findFirstActiveAdminUser: jest.fn().mockResolvedValue(null),
        createUpgrade: jest.fn().mockRejectedValue(new Error('DB upgrade insert failed')),
      };
      const repoMock = {
        transaction: jest.fn().mockImplementation(async (cb) => cb(sessionMock)),
      };
      const pdfRendererMock = {
        renderPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 upgrade')),
      };
      const documensoMock = {
        isConfigured: jest.fn().mockReturnValue(true),
        createFourPartyEnvelope: jest.fn().mockResolvedValue({
          envelopeId: 'env-upgrade-rollback',
          envelopeItemId: 'item-upgrade-rollback',
          signers: [
            { role: 'FAMILY_REP', recipientId: 1, token: 'tok-up-a', signingUrl: 'https://sign.famidoc.online/sign/tok-up-a', status: 'NOT_SIGNED', completedAt: null },
            { role: 'HEALTHCARE_FACILITY', recipientId: 2, token: 'tok-up-b', signingUrl: 'https://sign.famidoc.online/sign/tok-up-b', status: 'NOT_SIGNED', completedAt: null },
            { role: 'ASSIGNED_DOCTOR', recipientId: 3, token: 'tok-up-c', signingUrl: 'https://sign.famidoc.online/sign/tok-up-c', status: 'NOT_SIGNED', completedAt: null },
            { role: 'ADMIN', recipientId: 4, token: 'tok-up-d', signingUrl: 'https://sign.famidoc.online/sign/tok-up-d', status: 'NOT_SIGNED', completedAt: null },
          ],
        }),
        deleteEnvelope: jest.fn().mockResolvedValue(undefined),
      };

      const service = new ContractsServiceImpl(
        repoMock as any,
        undefined,
        undefined,
        documensoMock as any,
        undefined,
        pdfRendererMock as any,
      );

      await expect(
        service.createPackageUpgradeContract(familyUser, oldContract.id, {
          packageId: mockPkg.id,
          kind: 'RENEWAL',
        }),
      ).rejects.toThrow('DB upgrade insert failed');

      expect(documensoMock.createFourPartyEnvelope).not.toHaveBeenCalled();
      expect(documensoMock.deleteEnvelope).not.toHaveBeenCalled();
    });

    it('backfill (2B): bỏ qua token rỗng, bỏ qua email trùng nhiều vai trò và không tạo Invalid Date khi timestamp lỗi', async () => {
      const contract = makeContractRecord({
        documensoEnvelopeId: 'env-bf-edge',
        documensoItemId: 'item-bf-edge',
      });
      const savedRows: any[] = [];
      const sessionMock: any = {
        findContractForUpdate: jest.fn().mockResolvedValue(contract),
        findContractSignatures: jest.fn().mockResolvedValue([{ signerRole: 'FAMILY_REP' }]),
        findDocumensoSigners: jest.fn().mockImplementation(async () => [...savedRows]),
        findFamilyById: jest.fn().mockResolvedValue(mockFamily),
        findFacilityById: jest.fn().mockResolvedValue(mockFacility),
        findDoctorById: jest.fn().mockResolvedValue(mockDoctor),
        findFirstActiveAdminUser: jest.fn().mockResolvedValue({
          id: 'user-admin-1',
          email: 'admin@famidoc.online',
          fullName: 'Admin',
        }),
        saveDocumensoSigners: jest.fn().mockImplementation(async (rows) => {
          savedRows.push(...rows);
        }),
      };
      const repoMock = {
        transaction: jest.fn().mockImplementation(async (cb) => cb(sessionMock)),
      };

      // Case A: token rỗng -> bỏ qua, insert nothing, ném 404
      const documensoEmptyTok = {
        isConfigured: jest.fn().mockReturnValue(true),
        getEnvelope: jest.fn().mockResolvedValue({
          id: 'env-bf-edge',
          recipients: [
            { id: 12, email: 'doc@medsev.vn', token: '   ', signingStatus: 'NOT_SIGNED' },
          ],
        }),
      };
      const svcA = new ContractsServiceImpl(repoMock as any, undefined, undefined, documensoEmptyTok as any);
      await expect(svcA.getSigningSession(doctorUser, contract.id)).rejects.toThrow(NotFoundException);
      expect(sessionMock.saveDocumensoSigners).not.toHaveBeenCalled();

      // Case B: email trùng giữa 2 vai trò (Bác sĩ và Admin cùng dùng 1 email) -> mơ hồ -> bỏ qua, ném 404
      sessionMock.findFirstActiveAdminUser.mockResolvedValueOnce({
        id: 'user-admin-1',
        email: 'doc@medsev.vn',
        fullName: 'Admin',
      });
      const documensoDupEmail = {
        isConfigured: jest.fn().mockReturnValue(true),
        getEnvelope: jest.fn().mockResolvedValue({
          id: 'env-bf-edge',
          recipients: [
            { id: 12, email: 'doc@medsev.vn', token: 'tok-dup', signingStatus: 'NOT_SIGNED' },
          ],
        }),
      };
      const svcB = new ContractsServiceImpl(repoMock as any, undefined, undefined, documensoDupEmail as any);
      await expect(svcB.getSigningSession(doctorUser, contract.id)).rejects.toThrow(NotFoundException);
      expect(sessionMock.saveDocumensoSigners).not.toHaveBeenCalled();

      // Case C: timestamp signedAt không hợp lệ -> completedAt = null (không phải Invalid Date)
      sessionMock.findFirstActiveAdminUser.mockResolvedValueOnce({
        id: 'user-admin-1',
        email: 'admin@famidoc.online',
        fullName: 'Admin',
      });
      const documensoBadDate = {
        isConfigured: jest.fn().mockReturnValue(true),
        getEnvelope: jest.fn().mockResolvedValue({
          id: 'env-bf-edge',
          recipients: [
            {
              id: 12,
              email: 'doc@medsev.vn',
              token: 'tok-doc-valid',
              signingStatus: 'NOT_SIGNED',
              signedAt: 'not-a-valid-date',
            },
          ],
        }),
      };
      const svcC = new ContractsServiceImpl(repoMock as any, undefined, undefined, documensoBadDate as any);
      const res = await svcC.getSigningSession(doctorUser, contract.id);
      expect(res.signingToken).toBe('tok-doc-valid');
      expect(savedRows[0].completedAt).toBeNull();
    });

    it('backfill (2B): chặn 409 trước khi gọi getEnvelope nếu không phải Bên A và Bên A chưa ký, và bỏ qua insert khi TX 2 thấy hợp đồng đã chuyển trạng thái', async () => {
      const pendingContract = makeContractRecord({
        documensoEnvelopeId: 'env-bf-stale',
        documensoItemId: 'item-bf-stale',
      });
      const sessionMock: any = {
        findContractForUpdate: jest
          .fn()
          .mockResolvedValueOnce(pendingContract)
          .mockResolvedValueOnce(pendingContract)
          .mockResolvedValueOnce({ ...pendingContract, contractStatus: 'TERMINATED' }),
        findContractSignatures: jest
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([{ signerRole: 'FAMILY_REP' }])
          .mockResolvedValueOnce([{ signerRole: 'FAMILY_REP' }]),
        findDocumensoSigners: jest.fn().mockResolvedValue([]),
        findFamilyById: jest.fn().mockResolvedValue(mockFamily),
        findFacilityById: jest.fn().mockResolvedValue(mockFacility),
        findDoctorById: jest.fn().mockResolvedValue(mockDoctor),
        findFirstActiveAdminUser: jest.fn().mockResolvedValue({
          id: 'user-admin-1',
          email: 'admin@famidoc.online',
          fullName: 'Admin',
        }),
        saveDocumensoSigners: jest.fn(),
      };
      const repoMock = {
        transaction: jest.fn().mockImplementation(async (cb) => cb(sessionMock)),
      };
      const documensoMock = {
        isConfigured: jest.fn().mockReturnValue(true),
        getEnvelope: jest.fn().mockResolvedValue({
          id: 'env-bf-stale',
          recipients: [
            { id: 13, email: 'admin@famidoc.online', token: 'tok-d', signingStatus: 'NOT_SIGNED' },
          ],
        }),
      };
      const service = new ContractsServiceImpl(repoMock as any, undefined, undefined, documensoMock as any);

      // Chưa có chữ ký Bên A -> ném 409 mà không gọi getEnvelope
      await expect(service.getSigningSession(adminUser, pendingContract.id)).rejects.toThrow(
        ConflictException,
      );
      expect(documensoMock.getEnvelope).not.toHaveBeenCalled();

      // Bên A đã ký, nhưng giữa TX 1 và TX 2 hợp đồng chuyển sang TERMINATED -> không lưu signer, trả 200 read-only
      const staleRes = await service.getSigningSession(adminUser, pendingContract.id);
      expect(documensoMock.getEnvelope).toHaveBeenCalledTimes(1);
      expect(sessionMock.saveDocumensoSigners).not.toHaveBeenCalled();
      expect(staleRes).toMatchObject({
        contractStatus: 'TERMINATED',
        canSign: false,
        signingToken: null,
        signingUrl: null,
      });
    });

    it('lazy provision (1A): không gắn envelope nếu TX 2 thấy hợp đồng đã chuyển trạng thái và xóa envelope thừa', async () => {
      const pending = makeContractRecord({ documensoEnvelopeId: null, documensoItemId: null });
      const active = makeContractRecord({
        contractStatus: 'ACTIVE',
        documensoEnvelopeId: null,
        documensoItemId: null,
      });
      const sessionMock: any = {
        findContractForUpdate: jest
          .fn()
          .mockResolvedValueOnce(pending)
          .mockResolvedValueOnce(active),
        findContractSignatures: jest.fn().mockResolvedValue([]),
        findDocumensoSigners: jest.fn().mockResolvedValue([]),
        findFamilyById: jest.fn().mockResolvedValue(mockFamily),
        findFacilityById: jest.fn().mockResolvedValue(mockFacility),
        findDoctorById: jest.fn().mockResolvedValue(mockDoctor),
        findFirstActiveAdminUser: jest.fn().mockResolvedValue(null),
        updateContractDocumensoEnvelope: jest.fn(),
        saveDocumensoSigners: jest.fn(),
        clearLegacyNonDocumensoSignatures: jest.fn(),
      };
      const repoMock = {
        transaction: jest.fn().mockImplementation(async (cb) => cb(sessionMock)),
      };
      const pdfRendererMock = {
        renderPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4')),
      };
      const documensoMock = {
        isConfigured: jest.fn().mockReturnValue(true),
        createFourPartyEnvelope: jest.fn().mockResolvedValue({
          envelopeId: 'env-stale-lazy',
          envelopeItemId: 'item-stale-lazy',
          signers: [
            { role: 'FAMILY_REP', recipientId: 1, token: 'tok-a', signingUrl: 'https://sign.famidoc.online/sign/tok-a', status: 'NOT_SIGNED', completedAt: null },
            { role: 'HEALTHCARE_FACILITY', recipientId: 2, token: 'tok-b', signingUrl: 'https://sign.famidoc.online/sign/tok-b', status: 'NOT_SIGNED', completedAt: null },
            { role: 'ASSIGNED_DOCTOR', recipientId: 3, token: 'tok-c', signingUrl: 'https://sign.famidoc.online/sign/tok-c', status: 'NOT_SIGNED', completedAt: null },
            { role: 'ADMIN', recipientId: 4, token: 'tok-d', signingUrl: 'https://sign.famidoc.online/sign/tok-d', status: 'NOT_SIGNED', completedAt: null },
          ],
        }),
        deleteEnvelope: jest.fn().mockResolvedValue(undefined),
      };

      const service = new ContractsServiceImpl(
        repoMock as any,
        undefined,
        undefined,
        documensoMock as any,
        undefined,
        pdfRendererMock as any,
      );

      const res = await service.getSigningSession(familyUser, pending.id);
      expect(sessionMock.updateContractDocumensoEnvelope).not.toHaveBeenCalled();
      expect(sessionMock.saveDocumensoSigners).not.toHaveBeenCalled();
      expect(documensoMock.deleteEnvelope).toHaveBeenCalledWith('env-stale-lazy');
      expect(res).toMatchObject({
        contractStatus: 'ACTIVE',
        canSign: false,
        signingToken: null,
        signingUrl: null,
      });
    });

    it('createPackageUpgradeContract(): hỗ trợ ACTIVE/RENEWAL không ký lại Documenso, trả envelope khi existing và ném ConflictException khi gói bị ngừng', async () => {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const makeUpgradeSession = (oldOverrides: Record<string, any> = {}, pkgOverrides: Record<string, any> = {}) => {
        const oldContract = makeContractRecord({
          id: 'old-ctr-1',
          contractStatus: 'EXPIRED',
          endDate: yesterday,
          billingSnapshot: {
            package: { code: 'PKG-GOLD', durationMonths: 12 },
            members: { requestedCount: 2 },
            pricing: { totalPriceVnd: 6_000_000 },
            benefits: { quotas: { videoConsultations: 24 } },
          },
          ...oldOverrides,
        });
        const sessionMock: any = {
          findContractForUpdate: jest.fn().mockResolvedValue(oldContract),
          findOpenUpgrade: jest.fn().mockResolvedValue(null),
          hasOtherActiveContract: jest.fn().mockResolvedValue(false),
          findPackage: jest.fn().mockResolvedValue({ ...mockPkg, ...pkgOverrides }),
          countFamilyMembers: jest.fn().mockResolvedValue(2),
          findFamilyById: jest.fn().mockResolvedValue(mockFamily),
          findFacilityById: jest.fn().mockResolvedValue(mockFacility),
          findDoctorById: jest.fn().mockResolvedValue(mockDoctor),
          findFirstActiveAdminUser: jest.fn().mockResolvedValue(null),
          updateContractStatus: jest.fn(),
          refreshDoctorPanel: jest.fn(),
          createUpgrade: jest.fn().mockImplementation(async (data) =>
            makeContractRecord({ id: 'new-up-1', ...data }),
          ),
          saveDocumensoSigners: jest.fn(),
          recordChange: jest.fn(),
        };
        return { oldContract, sessionMock };
      };

      const makeDocumenso = (configured = true) => ({
        isConfigured: jest.fn().mockReturnValue(configured),
        createFourPartyEnvelope: jest.fn().mockResolvedValue({
          envelopeId: 'env-up-case',
          envelopeItemId: 'item-up-case',
          signers: [
            { role: 'FAMILY_REP', recipientId: 1, token: 'tok-up-a', signingUrl: 'https://sign.famidoc.online/sign/tok-up-a', status: 'NOT_SIGNED', completedAt: null },
            { role: 'HEALTHCARE_FACILITY', recipientId: 2, token: 'tok-up-b', signingUrl: 'https://sign.famidoc.online/sign/tok-up-b', status: 'NOT_SIGNED', completedAt: null },
            { role: 'ASSIGNED_DOCTOR', recipientId: 3, token: 'tok-up-c', signingUrl: 'https://sign.famidoc.online/sign/tok-up-c', status: 'NOT_SIGNED', completedAt: null },
            { role: 'ADMIN', recipientId: 4, token: 'tok-up-d', signingUrl: 'https://sign.famidoc.online/sign/tok-up-d', status: 'NOT_SIGNED', completedAt: null },
          ],
        }),
        deleteEnvelope: jest.fn().mockResolvedValue(undefined),
      });
      const pdfRendererMock = {
        renderPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4')),
      };

      // 1. ACTIVE + RENEWAL -> giữ nguyên trạng thái HĐ cũ, tạo HĐ gia hạn PENDING_PAYMENT không cần Documenso
      const activeCase = makeUpgradeSession({ contractStatus: 'ACTIVE', endDate: yesterday });
      const docActive = makeDocumenso(true);
      const svcActive = new ContractsServiceImpl(
        { transaction: (cb: any) => cb(activeCase.sessionMock) } as any,
        undefined,
        undefined,
        docActive as any,
        undefined,
        pdfRendererMock as any,
      );
      const renewalSummary = await svcActive.createPackageUpgradeContract(familyUser, activeCase.oldContract.id, {
        packageId: mockPkg.id,
        kind: 'RENEWAL',
      });
      expect(activeCase.sessionMock.updateContractStatus).not.toHaveBeenCalled();
      expect(docActive.createFourPartyEnvelope).not.toHaveBeenCalled();
      expect(renewalSummary.documensoEnvelopeId).toBeNull();
      expect(renewalSummary.contractStatus).toBe('PENDING_PAYMENT');

      // 2. isDemo=true -> không tạo envelope Documenso
      const demoCase = makeUpgradeSession({ isDemo: true });
      const docDemo = makeDocumenso(true);
      const svcDemo = new ContractsServiceImpl(
        { transaction: (cb: any) => cb(demoCase.sessionMock) } as any,
        undefined,
        undefined,
        docDemo as any,
        undefined,
        pdfRendererMock as any,
      );
      await svcDemo.createPackageUpgradeContract(familyUser, demoCase.oldContract.id, {
        packageId: mockPkg.id,
        kind: 'RENEWAL',
      });
      expect(docDemo.createFourPartyEnvelope).not.toHaveBeenCalled();

      // 3. Documenso chưa cấu hình -> không tạo envelope
      const unconfCase = makeUpgradeSession();
      const docUnconf = makeDocumenso(false);
      const svcUnconf = new ContractsServiceImpl(
        { transaction: (cb: any) => cb(unconfCase.sessionMock) } as any,
        undefined,
        undefined,
        docUnconf as any,
        undefined,
        pdfRendererMock as any,
      );
      await svcUnconf.createPackageUpgradeContract(familyUser, unconfCase.oldContract.id, {
        packageId: mockPkg.id,
        kind: 'RENEWAL',
      });
      expect(docUnconf.createFourPartyEnvelope).not.toHaveBeenCalled();

      // 4. existing open upgrade -> trả về hợp đồng đang mở (idempotent)
      const existingCase = makeUpgradeSession();
      existingCase.sessionMock.findOpenUpgrade.mockResolvedValue(
        makeContractRecord({
          id: 'existing-up-1',
          packageId: mockPkg.id,
          memberCount: 2,
          documensoEnvelopeId: 'env-existing-up',
          documensoItemId: 'item-existing-up',
          billingSnapshot: {
            package: { code: 'PKG-GOLD', durationMonths: 12 },
            members: { requestedCount: 2 },
            pricing: { totalPriceVnd: 6_000_000 },
            benefits: { quotas: { videoConsultations: 24 } },
          },
        }),
      );
      const svcExisting = new ContractsServiceImpl(
        { transaction: (cb: any) => cb(existingCase.sessionMock) } as any,
        undefined,
        undefined,
        makeDocumenso(true) as any,
      );
      const existingSummary = await svcExisting.createPackageUpgradeContract(
        familyUser,
        existingCase.oldContract.id,
        { packageId: mockPkg.id, kind: 'RENEWAL' },
      );
      expect(existingSummary.id).toBe('existing-up-1');
      expect(existingCase.sessionMock.createUpgrade).not.toHaveBeenCalled();

      // 5. Gói bị ngừng (RETIRED) -> ném ConflictException & không gọi Documenso
      const retiredCase = makeUpgradeSession({}, { status: 'RETIRED' });
      const docRetired = makeDocumenso(true);
      const svcRetired = new ContractsServiceImpl(
        { transaction: (cb: any) => cb(retiredCase.sessionMock) } as any,
        undefined,
        undefined,
        docRetired as any,
        undefined,
        pdfRendererMock as any,
      );
      await expect(
        svcRetired.createPackageUpgradeContract(familyUser, retiredCase.oldContract.id, {
          packageId: mockPkg.id,
          kind: 'RENEWAL',
        }),
      ).rejects.toThrow(ConflictException);
      expect(docRetired.createFourPartyEnvelope).not.toHaveBeenCalled();
      expect(docRetired.deleteEnvelope).not.toHaveBeenCalled();
    });
  });
});
