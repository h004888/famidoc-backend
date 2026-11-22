import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../../../core/auth/authenticated-request';
import type { StorageService } from '../../../core/services/storage.service';
import type {
  ComplaintContract,
  ComplaintDetail,
  ComplaintsSession,
  IComplaintsRepository,
} from '../repositories/interfaces/complaints.repository.interface';
import { ComplaintsServiceImpl } from '../services/impl/complaints.service.impl';

const familyUser: AuthenticatedUser = {
  id: '11111111-1111-4111-8111-111111111111',
  role: 'FAMILY_REP',
  familyUnitId: '22222222-2222-4222-8222-222222222222',
};
const facilityUser: AuthenticatedUser = {
  id: '33333333-3333-4333-8333-333333333333',
  role: 'HEALTHCARE_FACILITY',
};
const adminUser: AuthenticatedUser = {
  id: '44444444-4444-4444-8444-444444444444',
  role: 'ADMIN',
};

const baseContract = {
  id: '55555555-5555-4555-8555-555555555555',
  contractNumber: 'HD-4P-2026-0001',
  familyId: familyUser.familyUnitId!,
  facilityId: '66666666-6666-4666-8666-666666666666',
  doctorId: '77777777-7777-4777-8777-777777777777',
  familyUnit: { representativeUserId: familyUser.id },
  facility: { userId: facilityUser.id, facilityName: 'Phòng khám FamiDoc' },
  doctor: {
    userId: '88888888-8888-4888-8888-888888888888',
    doctorName: 'BS. Nguyễn Văn B',
  },
} as unknown as ComplaintContract;

describe('ComplaintsServiceImpl', () => {
  let session: jest.Mocked<ComplaintsSession>;
  let storage: jest.Mocked<Pick<StorageService, 'objectExists' | 'uploadFile'>>;
  let service: ComplaintsServiceImpl;

  beforeEach(() => {
    session = {
      findContract: jest.fn(),
      encounterBelongsToContract: jest.fn(),
      createComplaint: jest.fn(),
      findComplaint: jest.fn(),
      listComplaints: jest.fn(),
      updateComplaint: jest.fn(),
      recordComplaintEvent: jest.fn(),
    };
    const repository: IComplaintsRepository = {
      transaction: (work) => work(session),
    };
    storage = {
      objectExists: jest.fn().mockResolvedValue(true),
      uploadFile: jest
        .fn()
        .mockResolvedValue(`${familyUser.id}/complaints/123-bang-chung.png`),
    };
    service = new ComplaintsServiceImpl(
      repository,
      storage as unknown as StorageService,
    );
  });

  it('scopes listComplaints to the family representative contracts', async () => {
    session.listComplaints.mockResolvedValue({ items: [], total: 0 });
    const result = await service.listComplaints(familyUser, {
      status: 'RESOLVED',
      page: 2,
      limit: 10,
    });

    expect(session.listComplaints.mock.calls).toEqual([
      [
        {
          status: 'RESOLVED',
          contract: { familyUnit: { representativeUserId: familyUser.id } },
        },
        10,
        10,
      ],
    ]);
    expect(result).toEqual({ items: [], total: 0, page: 2, limit: 10 });
  });

  it('uploads valid complaint evidence under actor complaint namespace', async () => {
    const file = {
      originalname: 'proof.png',
      mimetype: 'image/png',
      buffer: Buffer.from([1, 2, 3]),
    } as Express.Multer.File;

    const uploaded = await service.uploadComplaintEvidence(familyUser, file);
    expect(storage.uploadFile).toHaveBeenCalledWith(
      expect.objectContaining({ originalname: 'bang-chung.png' }),
      `${familyUser.id}/complaints`,
    );
    expect(uploaded.evidenceKey).toBe(
      `${familyUser.id}/complaints/123-bang-chung.png`,
    );
  });

  it('rejects unsupported file type and unauthorized role on evidence upload', async () => {
    await expect(
      service.uploadComplaintEvidence(adminUser, {
        originalname: 'proof.png',
        mimetype: 'image/png',
        buffer: Buffer.from([1]),
      } as Express.Multer.File),
    ).rejects.toThrow(ForbiddenException);

    await expect(
      service.uploadComplaintEvidence(familyUser, {
        originalname: 'script.exe',
        mimetype: 'application/octet-stream',
        buffer: Buffer.from([1]),
      } as Express.Multer.File),
    ).rejects.toThrow(BadRequestException);
  });

  it('returns safe contract display info in getComplaintDetail for family owner', async () => {
    const complaint = {
      id: '99999999-9999-4999-8999-999999999999',
      complaintCode: 'CPTEST01',
      contractId: baseContract.id,
      complaintCategory: 'UNAUTHORIZED_FEE',
      description: 'Thu thêm phụ phí không có trong hợp đồng.',
      status: 'RESOLVED',
      facilityResponse: 'CSYT đã xác minh và nhắc nhở điều dưỡng.',
      resolutionOutcome: 'WARNING',
      resolutionNotes: 'Ban quản trị đã nhắc nhở và chấn chỉnh quy trình.',
      contract: baseContract,
    } as unknown as ComplaintDetail;
    session.findComplaint.mockResolvedValue(complaint);

    const detail = await service.getComplaintDetail(familyUser, complaint.id);
    expect(detail).toMatchObject({
      complaintCode: 'CPTEST01',
      resolutionOutcome: 'WARNING',
      resolutionNotes: 'Ban quản trị đã nhắc nhở và chấn chỉnh quy trình.',
      contract: {
        contractNumber: 'HD-4P-2026-0001',
        facility: { facilityName: 'Phòng khám FamiDoc' },
        doctor: { doctorName: 'BS. Nguyễn Văn B' },
      },
    });
  });

  it('requires facility response before Admin can resolve a complaint', async () => {
    const complaint = {
      id: '99999999-9999-4999-8999-999999999999',
      status: 'INVESTIGATING',
      facilityReviewedAt: null,
      contract: baseContract,
    } as unknown as ComplaintDetail;
    session.findComplaint.mockResolvedValue(complaint);

    await expect(
      service.resolveComplaint(adminUser, complaint.id, {
        action: 'RESOLVE',
        outcome: 'WARNING',
        notes: 'Cần xác minh từ CSYT trước khi ra phán quyết.',
      }),
    ).rejects.toThrow(ConflictException);
  });
});
