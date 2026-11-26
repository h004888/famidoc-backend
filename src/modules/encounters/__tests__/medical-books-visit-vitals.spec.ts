import { Prisma } from '@prisma/client';
import { MedicalBooksService } from '../services/medical-books.service';

function makeActor(role: 'DOCTOR' | 'FAMILY_REP') {
  return {
    id: role === 'DOCTOR' ? 'doc-user-1' : 'rep-1',
    role,
    familyUnitId: role === 'FAMILY_REP' ? 'fam-1' : null,
  } as any;
}

function makeVisitPayload(clinicalEmr: any) {
  return {
    id: 'enc-1',
    encounterType: 'HOME_VISIT',
    visitScope: 'FAMILY',
    scheduledDate: new Date('2026-11-26T00:00:00.000Z'),
    scheduledTime: new Date('1970-01-01T08:30:00.000Z'),
    participants: [
      {
        patient: {
          id: 'pat-1',
          fullName: 'Nguyễn Văn A',
          dateOfBirth: new Date('1990-01-01'),
          relationshipToHead: 'SELF',
          familyId: 'fam-1',
          gender: 'MALE',
        },
      },
    ],
    doctor: {
      doctorName: 'BS. Minh',
      facility: { facilityName: 'PK FamiDoc', address: '12 Lê Lợi' },
      user: { phone: '0901234567' },
    },
    contract: {
      familyId: 'fam-1',
      familyUnit: {
        representativeUser: {
          id: 'rep-1',
          fullName: 'Chủ hộ',
          role: 'FAMILY_REP',
          status: 'ACTIVE',
        },
      },
    },
    clinicalEmrs: clinicalEmr ? [clinicalEmr] : [],
  };
}

function createHarness(visit: any, latestVital: any = null) {
  const prisma: any = {
    encounter: { findFirst: jest.fn().mockResolvedValue(visit) },
    vitalSign: { findFirst: jest.fn().mockResolvedValue(latestVital) },
    auditLog: { create: jest.fn().mockResolvedValue({ id: 'audit-1' }) },
  };
  const storage: any = {};
  const service = new MedicalBooksService(prisma, storage);
  return { service, prisma };
}

describe('Task 5: MedicalBooksService.visitDetail vitals theo vai trò', () => {
  const recordedAt = new Date('2026-11-26T09:00:00.000Z');
  const draftVital = {
    systolicBp: 118,
    diastolicBp: 76,
    heartRate: 78,
    temperature: new Prisma.Decimal('36.8'),
    spo2: 98,
    respiratoryRate: 18,
    weightKg: new Prisma.Decimal('61.0'),
    recordedAt,
  };

  it('(a) DOCTOR: EMR có vitalSign trả về source DRAFT và Decimal -> number', async () => {
    const visit = makeVisitPayload({
      id: 'emr-1',
      patientId: 'pat-1',
      patient: makeVisitPayload(null).participants[0].patient,
      chiefComplaint: 'Ho',
      clinicalFindings: 'Ổn',
      icd10Code: 'J06.9',
      icd10Diagnosis: 'Viêm họng',
      treatmentPlan: 'Theo dõi',
      isFinalized: false,
      finalizedAt: null,
      prescriptions: [],
      vitalSigns: [draftVital],
    });
    const { service } = createHarness(visit);

    const result = await service.visitDetail(makeActor('DOCTOR'), 'enc-1', 'pat-1');

    expect((result as any).vitals).toEqual({
      systolicBp: 118,
      diastolicBp: 76,
      heartRate: 78,
      temperature: 36.8,
      spo2: 98,
      respiratoryRate: 18,
      weightKg: 61,
      recordedAt,
      source: 'DRAFT',
    });
  });

  it('(b) DOCTOR: EMR không có vitals, patient có vitals cũ -> source PREVIOUS', async () => {
    const visit = makeVisitPayload(null);
    const { service } = createHarness(visit, {
      ...draftVital,
      systolicBp: 112,
      weightKg: new Prisma.Decimal('60.0'),
    });

    const result = await service.visitDetail(makeActor('DOCTOR'), 'enc-1', 'pat-1');

    expect((result as any).vitals).toMatchObject({
      systolicBp: 112,
      weightKg: 60,
      source: 'PREVIOUS',
    });
  });

  it('(c) DOCTOR: không có vitals nào -> vitals: null', async () => {
    const { service } = createHarness(makeVisitPayload(null), null);

    const result = await service.visitDetail(makeActor('DOCTOR'), 'enc-1', 'pat-1');

    expect((result as any).vitals).toBeNull();
  });

  it('(d) FAMILY_REP: EMR chưa chốt có vitals -> vitals: null', async () => {
    const visit = makeVisitPayload({
      id: 'emr-1',
      patientId: 'pat-1',
      patient: makeVisitPayload(null).participants[0].patient,
      chiefComplaint: 'Ho',
      clinicalFindings: 'Ổn',
      icd10Code: 'J06.9',
      icd10Diagnosis: 'Viêm họng',
      treatmentPlan: 'Theo dõi',
      isFinalized: false,
      finalizedAt: null,
      prescriptions: [],
      vitalSigns: [draftVital],
    });
    const { service } = createHarness(visit);

    const result = await service.visitDetail(makeActor('FAMILY_REP'), 'enc-1', 'pat-1');

    expect((result as any).vitals).toBeNull();
  });

  it('(e) FAMILY_REP: EMR đã chốt có vitals -> source DRAFT', async () => {
    const visit = makeVisitPayload({
      id: 'emr-1',
      patientId: 'pat-1',
      patient: makeVisitPayload(null).participants[0].patient,
      chiefComplaint: 'Ho',
      clinicalFindings: 'Ổn',
      icd10Code: 'J06.9',
      icd10Diagnosis: 'Viêm họng',
      treatmentPlan: 'Theo dõi',
      isFinalized: true,
      finalizedAt: recordedAt,
      prescriptions: [],
      vitalSigns: [draftVital],
    });
    const { service } = createHarness(visit);

    const result = await service.visitDetail(makeActor('FAMILY_REP'), 'enc-1', 'pat-1');

    expect((result as any).vitals).toMatchObject({
      systolicBp: 118,
      weightKg: 61,
      source: 'DRAFT',
    });
  });

  it('(f) FAMILY_REP: chưa có EMR nhưng patient có vitals cũ -> vitals: null', async () => {
    const { service } = createHarness(makeVisitPayload(null), draftVital);

    const result = await service.visitDetail(makeActor('FAMILY_REP'), 'enc-1', 'pat-1');

    expect((result as any).vitals).toBeNull();
  });
});
