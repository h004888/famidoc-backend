import { HttpStatus } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { EncounterRecordErrorCode } from '../../../core/constants/error-codes.constant';
import { BaseApiException } from '../../../core/exceptions/api.exception';
import { ConfirmVisitRecordDto } from '../dtos/share-prescription.dto';
import { PrescriptionsService } from '../services/prescriptions.service';

const doctorActor = {
  id: 'doc-user-1',
  role: 'DOCTOR',
  email: 'doctor@famidoc.vn',
  status: 'ACTIVE',
  familyUnitId: null,
} as any;

const PATIENT_UUID = '9b44a2a0-2f8d-4bb4-8b2d-f7640e8d0c7e';
const RECIPIENT_UUID = '10000000-0000-4000-8000-000000000001';
const OLD_RX_UUID = '20000000-0000-4000-8000-000000000002';

const catalogEntries = [
  {
    code: 'J06.9',
    nameVi: 'Nhiễm trùng đường hô hấp trên cấp, không đặc hiệu',
    nameEn: 'Acute upper respiratory infection, unspecified',
    chapter: 'X',
    daggerAsterisk: 'NONE',
    allowedAsPrimary: true,
    longTermEligible: false,
  },
  {
    code: 'I10',
    nameVi: 'Tăng huyết áp vô căn (nguyên phát)',
    nameEn: 'Essential (primary) hypertension',
    chapter: 'IX',
    daggerAsterisk: 'NONE',
    allowedAsPrimary: true,
    longTermEligible: true,
  },
];

const baseDrug = {
  medicationName: 'Amlor',
  activeIngredient: 'Amlodipine',
  strength: '5mg',
  dosage: '1 viên',
  administrationRoute: 'Uống',
  frequency: '1 lần/ngày sáng',
  quantity: 60,
  unit: 'Viên',
  durationDays: 60,
};

const baseExam = {
  chiefComplaint: 'Tái khám định kỳ',
  clinicalFindings: 'Huyết áp ổn định 125/80 mmHg',
  treatmentPlan: 'Tiếp tục điều trị ngoại trú và theo dõi tại nhà',
};

const baseContext = {
  address: '12 Lê Lợi, Q.1, TP.HCM',
  phone: '0901234567',
  longTermReason: 'Bệnh nhân tăng huyết áp ổn định, theo dõi tại nhà 60 ngày.',
};

function makeBaseVisit(overrides: Record<string, unknown> = {}) {
  return {
    id: 'enc-1',
    encounterType: 'HOME_VISIT',
    encounterStatus: 'IN_PROGRESS',
    scheduledDate: new Date('2026-11-27T00:00:00.000Z'),
    scheduledTime: new Date('1970-01-01T08:30:00.000Z'),
    familyConfirmedArrivalAt: null,
    participants: [
      {
        patient: {
          id: PATIENT_UUID,
          fullName: 'Nguyễn Văn A',
          familyId: 'fam-1',
          dateOfBirth: new Date('1965-05-10'),
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
          id: RECIPIENT_UUID,
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

function createHarness(
  visitOverrides: Record<string, unknown> = {},
  options: { withIcd10?: boolean } = { withIcd10: true },
) {
  const patientRecord = {
    id: PATIENT_UUID,
    fullName: 'Nguyễn Văn A',
    familyId: 'fam-1',
    dateOfBirth: new Date('1965-05-10'),
    gender: 'MALE',
  };

  const tx: any = {
    encounter: {
      findFirst: jest.fn().mockResolvedValue(makeBaseVisit(visitOverrides)),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    patient: {
      findFirst: jest.fn().mockResolvedValue({ id: PATIENT_UUID }),
      update: jest.fn().mockResolvedValue({ id: PATIENT_UUID }),
    },
    clinicalEmr: {
      create: jest.fn().mockResolvedValue({ id: 'emr-1', isFinalized: true }),
      update: jest.fn().mockResolvedValue({ id: 'emr-1', isFinalized: true }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        chiefComplaint: baseExam.chiefComplaint,
        clinicalFindings: baseExam.clinicalFindings,
        icd10Code: 'J06.9',
        icd10Diagnosis: 'Nhiễm trùng đường hô hấp trên cấp, không đặc hiệu',
        treatmentPlan: baseExam.treatmentPlan,
        patient: patientRecord,
      }),
    },
    clinicalEmrDiagnosis: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    homeMedication: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    vitalSign: {
      upsert: jest.fn().mockResolvedValue({ id: 'vs-1' }),
      create: jest.fn(),
    },
    prescription: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(async ({ data }) => ({
        id: 'rx-new',
        prescriptionCode: data.prescriptionCode,
      })),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
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

  const icd10Service: any = options.withIcd10
    ? {
        findActiveByCodes: jest.fn(async (codes: string[]) => {
          const normalized = new Set(codes.map((c) => c.trim().toUpperCase()));
          return catalogEntries.filter((e) => normalized.has(e.code));
        }),
      }
    : undefined;

  const service = new PrescriptionsService(prisma, icd10Service);
  return { service, tx, prisma, icd10Service };
}

describe('Task 6: confirmVisitRecord & đơn nối tiếp', () => {
  describe('DTO validation', () => {
    it('chấp nhận ConfirmVisitRecordDto với diagnoses, changeType, replacesPrescriptionId, discontinuedMedications', async () => {
      const dto = plainToInstance(ConfirmVisitRecordDto, {
        patientId: PATIENT_UUID,
        confirmed: true,
        exam: {
          ...baseExam,
          progression: 'IMPROVED',
          followUpDate: '2026-12-27',
          diagnoses: [
            { icd10Code: 'J06.9', isPrimary: true },
            { icd10Code: 'I10', isPrimary: false },
          ],
          homeMedications: [
            {
              medicationName: 'Amlodipine 5mg',
              source: 'FAMIDOC_PRESCRIPTION',
              assessment: 'CONTINUE',
            },
          ],
        },
        prescription: {
          recipientUserId: RECIPIENT_UUID,
          recipientAuthorized: true,
          replacesPrescriptionId: OLD_RX_UUID,
          discontinuedMedications: [
            { medicationName: 'Paracetamol 500mg', reason: 'Hết sốt' },
          ],
          clinicalContext: baseContext,
          details: [{ ...baseDrug, changeType: 'KEEP' }],
        },
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('từ chối discontinuedMedications khi reason < 3 ký tự', async () => {
      const dto = plainToInstance(ConfirmVisitRecordDto, {
        patientId: PATIENT_UUID,
        confirmed: true,
        exam: { ...baseExam, icd10Code: 'I10', icd10Diagnosis: 'Tăng huyết áp' },
        prescription: {
          recipientUserId: RECIPIENT_UUID,
          recipientAuthorized: true,
          discontinuedMedications: [
            { medicationName: 'Paracetamol 500mg', reason: 'Ok' },
          ],
          details: [baseDrug],
        },
      });

      const errors = await validate(dto);
      const rxError = errors.find((e) => e.property === 'prescription');
      expect(rxError).toBeDefined();
    });
  });

  it('(a) bệnh chính J06.9 (longTermEligible=false) + kèm theo I10 (true), thuốc 60 ngày, longTermReason 20+ ký tự → tạo đơn', async () => {
    const { service, tx } = createHarness();

    const result = await service.confirmVisitRecord(doctorActor, 'enc-1', {
      patientId: PATIENT_UUID,
      confirmed: true,
      exam: {
        ...baseExam,
        diagnoses: [
          { icd10Code: 'J06.9', isPrimary: true },
          { icd10Code: 'I10', isPrimary: false },
        ],
      },
      prescription: {
        recipientUserId: RECIPIENT_UUID,
        recipientAuthorized: true,
        clinicalContext: baseContext,
        details: [baseDrug],
      },
    } as ConfirmVisitRecordDto);

    expect(result.encounterId).toBe('enc-1');
    expect(tx.clinicalEmrDiagnosis.createMany).toHaveBeenCalledTimes(1);
    expect(tx.prescription.create).toHaveBeenCalledTimes(1);
  });

  it('(b) chỉ J06.9 (longTermEligible=false), thuốc 60 ngày → lỗi LONG_TERM_PRESCRIPTION_NOT_ELIGIBLE có conditions[0].code === P_VII', async () => {
    const { service, tx } = createHarness();

    let caught: unknown;
    try {
      await service.confirmVisitRecord(doctorActor, 'enc-1', {
        patientId: PATIENT_UUID,
        confirmed: true,
        exam: {
          ...baseExam,
          diagnoses: [{ icd10Code: 'J06.9', isPrimary: true }],
        },
        prescription: {
          recipientUserId: RECIPIENT_UUID,
          recipientAuthorized: true,
          clinicalContext: baseContext,
          details: [baseDrug],
        },
      } as ConfirmVisitRecordDto);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(BaseApiException);
    const apiErr = caught as BaseApiException;
    expect(apiErr.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect(apiErr.errorCode).toBe(
      EncounterRecordErrorCode.LONG_TERM_PRESCRIPTION_NOT_ELIGIBLE,
    );
    expect(apiErr.conditions?.[0]?.code).toBe('P_VII');
    expect(tx.prescription.create).not.toHaveBeenCalled();
  });

  it('(c) thuốc 91 ngày → lỗi PRESCRIPTION_DURATION_OUT_OF_RANGE', async () => {
    const { service, tx } = createHarness();

    let caught: unknown;
    try {
      await service.confirmVisitRecord(doctorActor, 'enc-1', {
        patientId: PATIENT_UUID,
        confirmed: true,
        exam: {
          ...baseExam,
          diagnoses: [{ icd10Code: 'I10', isPrimary: true }],
        },
        prescription: {
          recipientUserId: RECIPIENT_UUID,
          recipientAuthorized: true,
          clinicalContext: baseContext,
          details: [{ ...baseDrug, durationDays: 91 }],
        },
      } as ConfirmVisitRecordDto);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(BaseApiException);
    const apiErr = caught as BaseApiException;
    expect(apiErr.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect(apiErr.errorCode).toBe(
      EncounterRecordErrorCode.PRESCRIPTION_DURATION_OUT_OF_RANGE,
    );
    expect(tx.prescription.create).not.toHaveBeenCalled();
  });

  it('(d) replacesPrescriptionId của bệnh nhân khác → PRESCRIPTION_REPLACEMENT_INVALID status 409', async () => {
    const { service, tx } = createHarness();
    tx.prescription.findFirst.mockResolvedValue({
      id: 'rx-other',
      status: 'ISSUED',
      replacedBy: null,
      clinicalEmr: { patientId: 'other-patient' },
      details: [{ medicationName: 'Amlodipine (Amlor)' }],
    });

    let caught: unknown;
    try {
      await service.confirmVisitRecord(doctorActor, 'enc-1', {
        patientId: PATIENT_UUID,
        confirmed: true,
        exam: {
          ...baseExam,
          diagnoses: [{ icd10Code: 'I10', isPrimary: true }],
        },
        prescription: {
          recipientUserId: RECIPIENT_UUID,
          recipientAuthorized: true,
          replacesPrescriptionId: 'rx-other',
          clinicalContext: baseContext,
          details: [{ ...baseDrug, durationDays: 30 }],
        },
      } as ConfirmVisitRecordDto);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(BaseApiException);
    const apiErr = caught as BaseApiException;
    expect(apiErr.getStatus()).toBe(HttpStatus.CONFLICT);
    expect(apiErr.errorCode).toBe(
      EncounterRecordErrorCode.PRESCRIPTION_REPLACEMENT_INVALID,
    );
    expect(tx.prescription.create).not.toHaveBeenCalled();
  });

  it('(e) đơn cũ đã có replacedBy → PRESCRIPTION_REPLACEMENT_INVALID status 409', async () => {
    const { service, tx } = createHarness();
    tx.prescription.findFirst.mockResolvedValue({
      id: 'rx-old',
      status: 'ISSUED',
      replacedBy: { id: 'rx-newer' },
      clinicalEmr: { patientId: PATIENT_UUID },
      details: [{ medicationName: 'Amlodipine (Amlor)' }],
    });

    let caught: unknown;
    try {
      await service.confirmVisitRecord(doctorActor, 'enc-1', {
        patientId: PATIENT_UUID,
        confirmed: true,
        exam: {
          ...baseExam,
          diagnoses: [{ icd10Code: 'I10', isPrimary: true }],
        },
        prescription: {
          recipientUserId: RECIPIENT_UUID,
          recipientAuthorized: true,
          replacesPrescriptionId: 'rx-old',
          clinicalContext: baseContext,
          details: [{ ...baseDrug, durationDays: 30 }],
        },
      } as ConfirmVisitRecordDto);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(BaseApiException);
    const apiErr = caught as BaseApiException;
    expect(apiErr.getStatus()).toBe(HttpStatus.CONFLICT);
    expect(apiErr.errorCode).toBe(
      EncounterRecordErrorCode.PRESCRIPTION_REPLACEMENT_INVALID,
    );
  });

  it('(f) đơn nối tiếp hợp lệ → replacesPrescriptionId=rx-old, replacementReason bắt đầu bằng "Tái khám tại nhà ngày", changeType=KEEP, discontinuedMedications', async () => {
    const { service, tx } = createHarness();
    tx.prescription.findFirst.mockResolvedValue({
      id: 'rx-old',
      status: 'ISSUED',
      replacedBy: null,
      clinicalEmr: { patientId: PATIENT_UUID },
      details: [{ medicationName: 'Amlodipine (Amlor)' }],
    });

    await service.confirmVisitRecord(doctorActor, 'enc-1', {
      patientId: PATIENT_UUID,
      confirmed: true,
      exam: {
        ...baseExam,
        diagnoses: [{ icd10Code: 'I10', isPrimary: true }],
      },
      prescription: {
        recipientUserId: RECIPIENT_UUID,
        recipientAuthorized: true,
        replacesPrescriptionId: 'rx-old',
        discontinuedMedications: [
          { medicationName: 'Paracetamol 500mg', reason: 'Hết sốt' },
        ],
        clinicalContext: baseContext,
        details: [{ ...baseDrug, durationDays: 30, changeType: 'KEEP' }],
      },
    } as ConfirmVisitRecordDto);

    expect(tx.prescription.create).toHaveBeenCalledTimes(1);
    const saved = tx.prescription.create.mock.calls[0][0].data;
    expect(saved.replacesPrescriptionId).toBe('rx-old');
    expect(saved.replacementReason).toMatch(/^Tái khám tại nhà ngày \d{4}-\d{2}-\d{2}, cập nhật đơn\.$/);
    expect(saved.details.create[0].changeType).toBe('KEEP');
    expect(saved.discontinuedMedications).toEqual([
      { medicationName: 'Paracetamol 500mg', reason: 'Hết sốt' },
    ]);
    // Đơn cũ giữ nguyên status ISSUED (không updateMany sang CANCELLED)
    expect(tx.prescription.updateMany).not.toHaveBeenCalled();
  });

  it('(g) changeType KEEP cho thuốc không có trong đơn cũ → lỗi 422 có invalidParams[0].field === prescription.details[0].changeType', async () => {
    const { service, tx } = createHarness();
    tx.prescription.findFirst.mockResolvedValue({
      id: 'rx-old',
      status: 'ISSUED',
      replacedBy: null,
      clinicalEmr: { patientId: PATIENT_UUID },
      details: [{ medicationName: 'Metformin 500mg' }],
    });

    let caught: unknown;
    try {
      await service.confirmVisitRecord(doctorActor, 'enc-1', {
        patientId: PATIENT_UUID,
        confirmed: true,
        exam: {
          ...baseExam,
          diagnoses: [{ icd10Code: 'I10', isPrimary: true }],
        },
        prescription: {
          recipientUserId: RECIPIENT_UUID,
          recipientAuthorized: true,
          replacesPrescriptionId: 'rx-old',
          clinicalContext: baseContext,
          details: [{ ...baseDrug, durationDays: 30, changeType: 'KEEP' }],
        },
      } as ConfirmVisitRecordDto);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(BaseApiException);
    const apiErr = caught as BaseApiException;
    expect(apiErr.getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(apiErr.invalidParams?.[0]?.field).toBe(
      'prescription.details[0].changeType',
    );
    expect(apiErr.invalidParams?.[0]?.message).toBe(
      'Thuốc này không có trong đơn đang dùng nên không thể chọn Giữ nguyên/Đổi liều.',
    );
    expect(tx.prescription.create).not.toHaveBeenCalled();
  });

  it('(h) không gửi diagnoses, exam.icd10Code = I10, thuốc 60 ngày → vẫn tạo đơn (hành vi cũ)', async () => {
    const { service, tx } = createHarness({}, { withIcd10: false });
    tx.clinicalEmr.findUniqueOrThrow.mockResolvedValue({
      chiefComplaint: baseExam.chiefComplaint,
      clinicalFindings: baseExam.clinicalFindings,
      icd10Code: 'I10',
      icd10Diagnosis: 'Tăng huyết áp vô căn',
      treatmentPlan: baseExam.treatmentPlan,
      patient: {
        id: PATIENT_UUID,
        fullName: 'Nguyễn Văn A',
        familyId: 'fam-1',
        dateOfBirth: new Date('1965-05-10'),
        gender: 'MALE',
      },
    });

    await service.confirmVisitRecord(doctorActor, 'enc-1', {
      patientId: PATIENT_UUID,
      confirmed: true,
      exam: {
        ...baseExam,
        icd10Code: 'I10',
        icd10Diagnosis: 'Tăng huyết áp vô căn',
      },
      prescription: {
        recipientUserId: RECIPIENT_UUID,
        recipientAuthorized: true,
        clinicalContext: baseContext,
        details: [baseDrug],
      },
    } as ConfirmVisitRecordDto);

    expect(tx.prescription.create).toHaveBeenCalledTimes(1);
  });

  it('confirmVisitRecord không có diagnoses và không có icd10Code → lỗi ICD10_PRIMARY_REQUIRED (422)', async () => {
    const { service, tx } = createHarness();

    let caught: unknown;
    try {
      await service.confirmVisitRecord(doctorActor, 'enc-1', {
        patientId: PATIENT_UUID,
        confirmed: true,
        exam: { ...baseExam },
      } as ConfirmVisitRecordDto);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(BaseApiException);
    const apiErr = caught as BaseApiException;
    expect(apiErr.getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(apiErr.errorCode).toBe(
      EncounterRecordErrorCode.ICD10_PRIMARY_REQUIRED,
    );
    expect(tx.clinicalEmr.create).not.toHaveBeenCalled();
  });
});

describe('Chuẩn lỗi AGENTS.md cho confirmVisitRecord / createSharedPrescription', () => {
  const examWithPrimary = {
    ...baseExam,
    diagnoses: [{ icd10Code: 'I10', isPrimary: true }],
  };
  const rx = (overrides: Record<string, unknown> = {}, drug: Record<string, unknown> = {}) => ({
    recipientUserId: RECIPIENT_UUID,
    recipientAuthorized: true,
    clinicalContext: baseContext,
    details: [{ ...baseDrug, durationDays: 30, ...drug }],
    ...overrides,
  });

  async function expectApiError(
    promise: Promise<unknown>,
    errorCode: string,
    status: number,
    field?: string,
  ) {
    const err = await promise.then(
      () => {
        throw new Error('Không ném lỗi');
      },
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(BaseApiException);
    const apiErr = err as BaseApiException;
    expect(apiErr.errorCode).toBe(errorCode);
    expect(apiErr.getStatus()).toBe(status);
    if (field) {
      expect(apiErr.invalidParams?.[0]?.field).toBe(field);
      expect(apiErr.invalidParams?.[0]?.message).toMatch(/[À-ỹ]/);
    }
    if (status === 400 || status === 409) {
      if (!field) {
        expect(apiErr.conditions?.length).toBeGreaterThan(0);
        expect(apiErr.conditions?.[0]?.message).toMatch(/[À-ỹ]/);
      }
    }
  }

  it('confirmed khác true → 422 VALIDATION_FAILED field confirmed', async () => {
    const { service } = createHarness();
    await expectApiError(
      service.confirmVisitRecord(doctorActor, 'enc-1', {
        patientId: PATIENT_UUID,
        confirmed: false,
        exam: examWithPrimary,
      } as any),
      'VALIDATION_FAILED',
      422,
      'confirmed',
    );
  });

  it('trang khám đã xác nhận → 409 VISIT_RECORD_LOCKED có conditions', async () => {
    const { service } = createHarness({
      clinicalEmrs: [
        { id: 'emr-1', patientId: PATIENT_UUID, isFinalized: true, prescriptions: [] },
      ],
    });
    await expectApiError(
      service.confirmVisitRecord(doctorActor, 'enc-1', {
        patientId: PATIENT_UUID,
        confirmed: true,
        exam: examWithPrimary,
      } as ConfirmVisitRecordDto),
      'VISIT_RECORD_LOCKED',
      409,
    );
  });

  it('trang khám đã có đơn mà gửi thêm đơn → 409 VISIT_PRESCRIPTION_ALREADY_ISSUED', async () => {
    const { service } = createHarness({
      clinicalEmrs: [
        {
          id: 'emr-1',
          patientId: PATIENT_UUID,
          isFinalized: false,
          icd10Code: 'I10',
          prescriptions: [{ id: 'rx-1' }],
        },
      ],
    });
    await expectApiError(
      service.confirmVisitRecord(doctorActor, 'enc-1', {
        patientId: PATIENT_UUID,
        confirmed: true,
        exam: examWithPrimary,
        prescription: rx(),
      } as ConfirmVisitRecordDto),
      'VISIT_PRESCRIPTION_ALREADY_ISSUED',
      409,
    );
  });

  it('chưa có nội dung khám → 422 VALIDATION_FAILED field exam', async () => {
    const { service } = createHarness();
    await expectApiError(
      service.confirmVisitRecord(doctorActor, 'enc-1', {
        patientId: PATIENT_UUID,
        confirmed: true,
      } as ConfirmVisitRecordDto),
      'VALIDATION_FAILED',
      422,
      'exam',
    );
  });

  it('người nhận đơn không còn hợp lệ → 409 PRESCRIPTION_RECIPIENT_INVALID', async () => {
    const { service } = createHarness();
    await expectApiError(
      service.confirmVisitRecord(doctorActor, 'enc-1', {
        patientId: PATIENT_UUID,
        confirmed: true,
        exam: examWithPrimary,
        prescription: rx({ recipientUserId: OLD_RX_UUID }),
      } as ConfirmVisitRecordDto),
      'PRESCRIPTION_RECIPIENT_INVALID',
      409,
    );
  });

  it.each([
    ['thiếu nơi cư trú', { clinicalContext: { ...baseContext, address: ' ' } }, {}, 'prescription.clinicalContext.address'],
    ['thiếu số điện thoại', { clinicalContext: { ...baseContext, phone: '' } }, {}, 'prescription.clinicalContext.phone'],
    ['điều trị nội trú', { clinicalContext: { ...baseContext, treatmentMode: 'INPATIENT' } }, {}, 'prescription.clinicalContext.treatmentMode'],
    ['tên thuốc quá 150 ký tự', {}, { medicationName: 'A'.repeat(150) }, 'prescription.details[0].medicationName'],
    ['thiếu hoạt chất', {}, { activeIngredient: ' ' }, 'prescription.details[0].activeIngredient'],
  ])('%s → 422 VALIDATION_FAILED', async (_label, overrides, drug, field) => {
    const { service } = createHarness();
    await expectApiError(
      service.confirmVisitRecord(doctorActor, 'enc-1', {
        patientId: PATIENT_UUID,
        confirmed: true,
        exam: examWithPrimary,
        prescription: rx(overrides, drug),
      } as ConfirmVisitRecordDto),
      'VALIDATION_FAILED',
      422,
      field,
    );
  });
});
