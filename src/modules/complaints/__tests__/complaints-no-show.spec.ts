import { ComplaintsServiceImpl } from '../services/impl/complaints.service.impl';
import type {
  ComplaintsSession,
  IComplaintsRepository,
} from '../repositories/interfaces/complaints.repository.interface';
import type { AuthenticatedUser } from '../../../core/auth/authenticated-request';

describe('ComplaintsServiceImpl (DOCTOR_ABSENT -> DISPUTED)', () => {
  let service: ComplaintsServiceImpl;
  let mockSession: jest.Mocked<ComplaintsSession>;

  const familyActor: AuthenticatedUser = {
    id: 'user-family-1',
    role: 'FAMILY_REP',
    familyUnitId: 'fam-1',
  };

  const doctorActor: AuthenticatedUser = {
    id: 'user-doctor-1',
    role: 'DOCTOR',
    familyUnitId: null,
  };

  const sampleContract: any = {
    id: 'contract-1',
    familyUnit: { representativeUserId: 'user-family-1' },
    facility: { userId: 'user-facility-1' },
    doctor: { userId: 'user-doctor-1' },
  };

  beforeEach(() => {
    mockSession = {
      findContract: jest.fn().mockResolvedValue(sampleContract),
      encounterBelongsToContract: jest.fn().mockResolvedValue(true),
      createComplaint: jest.fn().mockResolvedValue({ id: 'complaint-1' } as any),
      findComplaint: jest.fn(),
      listComplaints: jest.fn(),
      updateComplaint: jest.fn(),
      recordComplaintEvent: jest.fn().mockResolvedValue(undefined),
      markEncounterDisputed: jest.fn().mockResolvedValue(undefined),
    } as any;

    const mockRepo: IComplaintsRepository = {
      transaction: jest.fn().mockImplementation((work) => work(mockSession)),
    };
    const mockStorage: any = {
      objectExists: jest.fn().mockResolvedValue(true),
    };

    service = new ComplaintsServiceImpl(mockRepo, mockStorage);
  });

  it('gọi markEncounterDisputed khi FAMILY_REP gửi complaint DOCTOR_ABSENT có encounterId', async () => {
    await service.submitIncidentComplaint(familyActor, {
      contractId: 'contract-1',
      encounterId: 'enc-1',
      category: 'DOCTOR_ABSENT' as any,
      description: 'Bác sĩ không đến khám theo lịch hẹn',
      evidenceKeys: [],
    });

    expect((mockSession as any).markEncounterDisputed).toHaveBeenCalledWith('enc-1');
  });

  it('KHÔNG gọi markEncounterDisputed khi category !== DOCTOR_ABSENT, thiếu encounterId, hoặc actor là DOCTOR', async () => {
    await service.submitIncidentComplaint(familyActor, {
      contractId: 'contract-1',
      encounterId: 'enc-1',
      category: 'OTHER' as any,
      description: 'Phản ánh khác',
      evidenceKeys: [],
    });

    await service.submitIncidentComplaint(familyActor, {
      contractId: 'contract-1',
      category: 'DOCTOR_ABSENT' as any,
      description: 'Thiếu encounterId',
      evidenceKeys: [],
    });

    await service.submitIncidentComplaint(doctorActor, {
      contractId: 'contract-1',
      encounterId: 'enc-1',
      category: 'DOCTOR_ABSENT' as any,
      description: 'Bác sĩ gửi',
      evidenceKeys: [],
    });

    expect((mockSession as any).markEncounterDisputed).not.toHaveBeenCalled();
  });
});
