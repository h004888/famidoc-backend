import { ValidationPipe, ConflictException, ServiceUnavailableException, NotFoundException } from '@nestjs/common';
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
});
