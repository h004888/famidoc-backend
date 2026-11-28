import { HttpStatus } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BaseApiException } from '../../../core/exceptions/api.exception';
import { SaveVisitDraftDto } from '../dtos/share-prescription.dto';
import { PrescriptionsService } from '../services/prescriptions.service';

const doctorActor = {
  id: 'doc-user-1',
  role: 'DOCTOR',
  email: 'doctor@famidoc.vn',
  status: 'ACTIVE',
  familyUnitId: null,
} as any;

const PATIENT_UUID = '9b44a2a0-2f8d-4bb4-8b2d-f7640e8d0c7e';

const catalogEntries = [
  {
    code: 'I10',
    nameVi: 'Tăng huyết áp vô căn (nguyên phát)',
    nameEn: 'Essential (primary) hypertension',
    chapter: 'IX',
    daggerAsterisk: 'NONE',
    allowedAsPrimary: true,
    longTermEligible: true,
  },
  {
    code: 'E11.9',
    nameVi: 'Đái tháo đường không phụ thuộc insulin không có biến chứng',
    nameEn: 'Type 2 diabetes mellitus without complications',
    chapter: 'IV',
    daggerAsterisk: 'NONE',
    allowedAsPrimary: true,
    longTermEligible: true,
  },
  {
    code: 'B96.2',
    nameVi: 'Escherichia coli [E. coli] là nguyên nhân gây bệnh phân loại ở chương khác',
    nameEn: 'Escherichia coli as the cause of diseases classified elsewhere',
    chapter: 'I',
    daggerAsterisk: 'NONE',
    allowedAsPrimary: false,
    longTermEligible: false,
  },
];

function makeBaseVisit(overrides: Record<string, unknown> = {}) {
  return {
    id: 'enc-1',
    encounterType: 'HOME_VISIT',
    encounterStatus: 'IN_PROGRESS',
    scheduledDate: new Date('2026-11-26T00:00:00.000Z'),
    scheduledTime: new Date('1970-01-01T08:30:00.000Z'),
    familyConfirmedArrivalAt: null,
    participants: [
      {
        patient: {
          id: 'pat-1',
          fullName: 'Nguyễn Văn A',
          familyId: 'fam-1',
          dateOfBirth: new Date('1990-01-01'),
          gender: 'MALE',
        },
      },
    ],
    doctor: {
      doctorName: 'BS. Minh',
      user: { phone: '0901234567' },
      facility: { facilityName: 'PK FamiDoc', address: '12 Lê Lợi' },
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
    clinicalEmrs: [],
    ...overrides,
  };
}

function createHarness(visitOverrides: Record<string, unknown> = {}) {
  const tx: any = {
    encounter: {
      findFirst: jest.fn().mockResolvedValue(makeBaseVisit(visitOverrides)),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    patient: {
      findFirst: jest.fn().mockResolvedValue({ id: 'pat-1' }),
      update: jest.fn().mockResolvedValue({ id: 'pat-1' }),
    },
    clinicalEmr: {
      create: jest.fn().mockResolvedValue({ id: 'emr-1', isFinalized: false }),
      update: jest.fn().mockResolvedValue({ id: 'emr-1', isFinalized: false }),
    },
    clinicalEmrDiagnosis: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    homeMedication: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    vitalSign: {
      upsert: jest.fn().mockResolvedValue({ id: 'vs-1' }),
      create: jest.fn(),
    },
    encounterParticipant: {
      upsert: jest.fn().mockResolvedValue({ id: 'ep-1' }),
    },
    auditLog: {
      create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
    },
    notification: {
      create: jest.fn().mockResolvedValue({ id: 'noti-1' }),
    },
  };
  const prisma: any = {
    $transaction: jest.fn((cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
  };
  const icd10Service: any = {
    findActiveByCodes: jest.fn().mockImplementation((codes: string[]) => {
      const normalized = new Set(codes.map((c) => c.trim().toUpperCase()));
      return Promise.resolve(
        catalogEntries.filter((entry) => normalized.has(entry.code)),
      );
    }),
  };
  const service = new PrescriptionsService(prisma, icd10Service);
  return { service, tx, prisma, icd10Service };
}

describe('Task 5 (MS 15/BV1): SaveVisitDraftDto validation', () => {
  it('báo lỗi tiếng Việt khi vitals.heightCm ngoài khoảng 30-250', async () => {
    const dto = plainToInstance(SaveVisitDraftDto, {
      patientId: PATIENT_UUID,
      vitals: { heightCm: 20 },
    });
    const errors = await validate(dto);
    const vitalsError = errors.find((e) => e.property === 'vitals');
    const heightError = vitalsError?.children?.find(
      (c) => c.property === 'heightCm',
    );
    expect(heightError).toBeDefined();
    expect(Object.values(heightError?.constraints ?? {})).toContain(
      'Chiều cao phải từ 30 đến 250 cm.',
    );
  });

  it('báo lỗi tiếng Việt khi exam.progression không hợp lệ', async () => {
    const dto = plainToInstance(SaveVisitDraftDto, {
      patientId: PATIENT_UUID,
      exam: { progression: 'BAD' },
    });
    const errors = await validate(dto);
    const examError = errors.find((e) => e.property === 'exam');
    const progressionError = examError?.children?.find(
      (c) => c.property === 'progression',
    );
    expect(progressionError).toBeDefined();
    expect(Object.values(progressionError?.constraints ?? {})).toContain(
      'Diễn tiến bệnh không hợp lệ.',
    );
  });

  it('báo lỗi tiếng Việt khi exam.followUpDate sai định dạng YYYY-MM-DD', async () => {
    const dto = plainToInstance(SaveVisitDraftDto, {
      patientId: PATIENT_UUID,
      exam: { followUpDate: '27/12/2026' },
    });
    const errors = await validate(dto);
    const examError = errors.find((e) => e.property === 'exam');
    const followUpError = examError?.children?.find(
      (c) => c.property === 'followUpDate',
    );
    expect(followUpError).toBeDefined();
    expect(Object.values(followUpError?.constraints ?? {})).toContain(
      'Ngày hẹn tái khám phải theo định dạng YYYY-MM-DD.',
    );
  });
});

describe('Task 5 (MS 15/BV1): PrescriptionsService.saveVisitDraft', () => {
  it('ghi nhận nhiều chẩn đoán ICD-10, snapshot tên tiếng Việt và đồng bộ bệnh chính vào clinicalEmr', async () => {
    const { service, tx } = createHarness({
      clinicalEmrs: [
        {
          id: 'emr-1',
          patientId: 'pat-1',
          isFinalized: false,
          prescriptions: [],
        },
      ],
    });

    await service.saveVisitDraft(doctorActor, 'enc-1', {
      patientId: 'pat-1',
      exam: {
        anamnesis: 'Đau đầu âm ỉ 3 ngày',
        progression: 'STABLE',
        followUpDate: '2026-12-15',
        diagnoses: [
          { icd10Code: 'I10', isPrimary: true },
          { icd10Code: 'E11.9', isPrimary: false },
        ],
      },
    } as any);

    expect(tx.clinicalEmr.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'emr-1' },
        data: expect.objectContaining({
          anamnesis: 'Đau đầu âm ỉ 3 ngày',
          progression: 'STABLE',
          icd10Code: 'I10',
          icd10Diagnosis: 'Tăng huyết áp vô căn (nguyên phát)',
        }),
      }),
    );
    expect(tx.clinicalEmrDiagnosis.deleteMany).toHaveBeenCalledWith({
      where: { emrId: 'emr-1' },
    });
    expect(tx.clinicalEmrDiagnosis.createMany).toHaveBeenCalledWith({
      data: [
        {
          emrId: 'emr-1',
          icd10Code: 'I10',
          nameSnapshot: 'Tăng huyết áp vô căn (nguyên phát)',
          isPrimary: true,
          lineNumber: 0,
        },
        {
          emrId: 'emr-1',
          icd10Code: 'E11.9',
          nameSnapshot:
            'Đái tháo đường không phụ thuộc insulin không có biến chứng',
          isPrimary: false,
          lineNumber: 1,
        },
      ],
    });
  });

  it('ném lỗi 422 ICD10_PRIMARY_REQUIRED khi gửi 2 bệnh chính', async () => {
    const { service, tx } = createHarness();

    let caught: unknown;
    try {
      await service.saveVisitDraft(doctorActor, 'enc-1', {
        patientId: 'pat-1',
        exam: {
          diagnoses: [
            { icd10Code: 'I10', isPrimary: true },
            { icd10Code: 'E11.9', isPrimary: true },
          ],
        },
      } as any);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(BaseApiException);
    expect(caught).toMatchObject({
      errorCode: 'ICD10_PRIMARY_REQUIRED',
    });
    expect((caught as BaseApiException).getStatus()).toBe(
      HttpStatus.UNPROCESSABLE_ENTITY,
    );

    expect(tx.clinicalEmrDiagnosis.createMany).not.toHaveBeenCalled();
  });

  it('ném lỗi 422 ICD10_DIAGNOSIS_DUPLICATED khi trùng mã ICD-10', async () => {
    const { service } = createHarness();

    let caught: unknown;
    try {
      await service.saveVisitDraft(doctorActor, 'enc-1', {
        patientId: 'pat-1',
        exam: {
          diagnoses: [
            { icd10Code: 'I10', isPrimary: true },
            { icd10Code: 'i10', isPrimary: false },
          ],
        },
      } as any);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(BaseApiException);
    expect(caught).toMatchObject({
      errorCode: 'ICD10_DIAGNOSIS_DUPLICATED',
      invalidParams: expect.arrayContaining([
        expect.objectContaining({
          field: 'diagnoses[1].icd10Code',
        }),
      ]),
    });
    expect((caught as BaseApiException).getStatus()).toBe(
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  });

  it('ném lỗi 422 ICD10_NOT_ALLOWED_AS_PRIMARY khi chọn mã chỉ làm bệnh kèm theo làm bệnh chính', async () => {
    const { service } = createHarness();

    let caught: unknown;
    try {
      await service.saveVisitDraft(doctorActor, 'enc-1', {
        patientId: 'pat-1',
        exam: {
          diagnoses: [{ icd10Code: 'B96.2', isPrimary: true }],
        },
      } as any);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(BaseApiException);
    expect(caught).toMatchObject({
      errorCode: 'ICD10_NOT_ALLOWED_AS_PRIMARY',
      message: 'Mã B96.2 chỉ được dùng làm bệnh kèm theo.',
    });
    expect((caught as BaseApiException).getStatus()).toBe(
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  });

  it('ném lỗi 422 ICD10_CODE_NOT_FOUND khi mã không có trong danh mục', async () => {
    const { service } = createHarness();

    let caught: unknown;
    try {
      await service.saveVisitDraft(doctorActor, 'enc-1', {
        patientId: 'pat-1',
        exam: {
          diagnoses: [{ icd10Code: 'Z99.99', isPrimary: true }],
        },
      } as any);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(BaseApiException);
    expect(caught).toMatchObject({
      errorCode: 'ICD10_CODE_NOT_FOUND',
    });
    expect((caught as BaseApiException).getStatus()).toBe(
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  });

  it('ghi nhận homeMedications với deleteMany + createMany theo lineNumber 0, 1', async () => {
    const { service, tx } = createHarness();

    await service.saveVisitDraft(doctorActor, 'enc-1', {
      patientId: 'pat-1',
      exam: {
        homeMedications: [
          {
            medicationName: 'Amlodipine 5mg',
            source: 'FAMIDOC_PRESCRIPTION',
            assessment: 'CONTINUE',
            notes: 'Uống sáng',
          },
          {
            medicationName: 'Hoạt huyết dưỡng não',
            source: 'SELF_PURCHASED',
            assessment: 'STOP',
          },
        ],
      },
    } as any);

    expect(tx.homeMedication.deleteMany).toHaveBeenCalledWith({
      where: { emrId: 'emr-1' },
    });
    expect(tx.homeMedication.createMany).toHaveBeenCalledWith({
      data: [
        {
          emrId: 'emr-1',
          medicationName: 'Amlodipine 5mg',
          source: 'FAMIDOC_PRESCRIPTION',
          assessment: 'CONTINUE',
          notes: 'Uống sáng',
          lineNumber: 0,
        },
        {
          emrId: 'emr-1',
          medicationName: 'Hoạt huyết dưỡng não',
          source: 'SELF_PURCHASED',
          assessment: 'STOP',
          notes: null,
          lineNumber: 1,
        },
      ],
    });
  });

  it('lưu vitals.heightCm = 152.5 qua vitalSign.upsert', async () => {
    const { service, tx } = createHarness();

    await service.saveVisitDraft(doctorActor, 'enc-1', {
      patientId: 'pat-1',
      vitals: { heightCm: 152.5 },
    } as any);

    expect(tx.vitalSign.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { emrId: 'emr-1' },
        create: expect.objectContaining({ heightCm: 152.5 }),
        update: expect.objectContaining({ heightCm: 152.5 }),
      }),
    );
  });

  it('ném BaseApiException 409 VISIT_RECORD_LOCKED khi trang khám đã xác nhận', async () => {
    const { service, tx } = createHarness({
      clinicalEmrs: [
        {
          id: 'emr-1',
          patientId: 'pat-1',
          isFinalized: true,
          prescriptions: [],
        },
      ],
    });

    let caught: unknown;
    try {
      await service.saveVisitDraft(doctorActor, 'enc-1', {
        patientId: 'pat-1',
        exam: { chiefComplaint: 'Ho' },
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(BaseApiException);
    expect(caught).toMatchObject({
      errorCode: 'VISIT_RECORD_LOCKED',
    });
    expect((caught as BaseApiException).getStatus()).toBe(HttpStatus.CONFLICT);
    expect(tx.clinicalEmr.update).not.toHaveBeenCalled();
  });
});
