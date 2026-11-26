import { ConflictException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  ConfirmVisitRecordDto,
  SaveVisitDraftDto,
} from '../dtos/share-prescription.dto';
import { PrescriptionsService } from '../services/prescriptions.service';

const doctorActor = {
  id: 'doc-user-1',
  role: 'DOCTOR',
  email: 'doctor@famidoc.vn',
  status: 'ACTIVE',
  familyUnitId: null,
} as any;

const validExam = {
  chiefComplaint: 'Ho kéo dài',
  clinicalFindings: 'Phổi ran ẩm nhẹ',
  icd10Code: 'J06.9',
  icd10Diagnosis: 'Viêm đường hô hấp trên cấp',
  treatmentPlan: 'Nghỉ ngơi, uống đủ nước',
};

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
  const service = new PrescriptionsService(prisma);
  return { service, tx, prisma };
}

describe('Task 2: saveVisitDraft vitals upsert & validation', () => {
  it('(a) upsert vitalSign theo emrId với weightKg khi lưu nháp', async () => {
    const { service, tx } = createHarness();

    await service.saveVisitDraft(doctorActor, 'enc-1', {
      patientId: 'pat-1',
      vitals: { systolicBp: 120, weightKg: 60.5 },
    });

    expect(tx.vitalSign.upsert).toHaveBeenCalledTimes(1);
    expect(tx.vitalSign.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { emrId: 'emr-1' },
        create: expect.objectContaining({
          emrId: 'emr-1',
          patientId: 'pat-1',
          systolicBp: 120,
          weightKg: 60.5,
          isAbnormalAlert: false,
        }),
        update: expect.objectContaining({
          systolicBp: 120,
          weightKg: 60.5,
          isAbnormalAlert: false,
        }),
      }),
    );
  });

  it('(b) lưu nháp lần 2 vẫn gọi upsert, không gọi vitalSign.create', async () => {
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
      vitals: { systolicBp: 125 },
    });

    expect(tx.vitalSign.upsert).toHaveBeenCalledTimes(1);
    expect(tx.vitalSign.create).not.toHaveBeenCalled();
  });

  it('(c) không gửi vitals thì không gọi vitalSign.upsert', async () => {
    const { service, tx } = createHarness();

    await service.saveVisitDraft(doctorActor, 'enc-1', {
      patientId: 'pat-1',
      exam: { chiefComplaint: 'Đau đầu' },
    });

    expect(tx.vitalSign.upsert).not.toHaveBeenCalled();
  });

  it('(d) validate SaveVisitDraftDto báo lỗi khi spo2 ngoài khoảng 50-100', async () => {
    const dto = plainToInstance(SaveVisitDraftDto, {
      patientId: '9b44a2a0-2f8d-4bb4-8b2d-f7640e8d0c7e',
      vitals: { spo2: 120 },
    });
    const errors = await validate(dto);
    const vitalsError = errors.find((e) => e.property === 'vitals');
    expect(vitalsError).toBeDefined();
    expect(
      vitalsError?.children?.some((c) => c.property === 'spo2'),
    ).toBe(true);
  });

  it('(e) tính isAbnormalAlert đúng khi systolicBp bất thường và bình thường', async () => {
    const { service, tx } = createHarness();

    await service.saveVisitDraft(doctorActor, 'enc-1', {
      patientId: 'pat-1',
      vitals: { systolicBp: 150 },
    });
    expect(tx.vitalSign.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ isAbnormalAlert: true }),
        update: expect.objectContaining({ isAbnormalAlert: true }),
      }),
    );

    await service.saveVisitDraft(doctorActor, 'enc-1', {
      patientId: 'pat-1',
      vitals: { systolicBp: 120 },
    });
    expect(tx.vitalSign.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ isAbnormalAlert: false }),
        update: expect.objectContaining({ isAbnormalAlert: false }),
      }),
    );
  });
});

describe('Task 3: confirmVisitRecord ghi sinh hiệu + weightKg cùng transaction', () => {
  it('(a) confirm kèm vitals gọi upsert, cập nhật patient.weightKg và điểm danh EXAMINED', async () => {
    const { service, tx } = createHarness();

    await service.confirmVisitRecord(doctorActor, 'enc-1', {
      patientId: 'pat-1',
      confirmed: true,
      exam: validExam,
      vitals: { heartRate: 80, weightKg: 58 },
    } as ConfirmVisitRecordDto);

    expect(tx.vitalSign.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { emrId: 'emr-1' },
        create: expect.objectContaining({ heartRate: 80, weightKg: 58 }),
      }),
    );
    expect(tx.patient.update).toHaveBeenCalledWith({
      where: { id: 'pat-1' },
      data: { weightKg: 58 },
    });
    expect(tx.encounterParticipant.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { attendanceStatus: 'EXAMINED' },
      }),
    );
  });

  it('(b) lỗi từ createSharedPrescription nằm trong cùng transaction callback', async () => {
    const { service, tx, prisma } = createHarness();
    const createRxSpy = jest
      .spyOn(service as any, 'createSharedPrescription')
      .mockRejectedValueOnce(new Error('RX_FAIL'));

    await expect(
      service.confirmVisitRecord(doctorActor, 'enc-1', {
        patientId: 'pat-1',
        confirmed: true,
        exam: validExam,
        vitals: { heartRate: 80 },
        prescription: {
          recipientUserId: 'rep-1',
          recipientAuthorized: true,
          details: [],
        } as any,
      }),
    ).rejects.toThrow('RX_FAIL');

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(createRxSpy).toHaveBeenCalledWith(
      tx,
      doctorActor.id,
      expect.anything(),
      'emr-1',
      expect.anything(),
      expect.any(Date),
    );
  });

  it('(c) confirm lần 2 sau khi finalized ném ConflictException và không gọi upsert', async () => {
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

    await expect(
      service.confirmVisitRecord(doctorActor, 'enc-1', {
        patientId: 'pat-1',
        confirmed: true,
        exam: validExam,
        vitals: { heartRate: 80 },
      }),
    ).rejects.toThrow(new ConflictException('Trang khám đã được xác nhận.'));

    expect(tx.vitalSign.upsert).not.toHaveBeenCalled();
  });

  it('(d) confirm với spo2: 88 set isAbnormalAlert: true', async () => {
    const { service, tx } = createHarness();

    await service.confirmVisitRecord(doctorActor, 'enc-1', {
      patientId: 'pat-1',
      confirmed: true,
      exam: validExam,
      vitals: { spo2: 88 },
    });

    expect(tx.vitalSign.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ isAbnormalAlert: true }),
      }),
    );
  });
});

describe('Task 4: Phân biệt VISIT_NOT_STARTED và VISIT_LOCKED', () => {
  it('(a) chưa tới giờ (CONFIRMED) ném ConflictException code VISIT_NOT_STARTED có giờ bắt đầu', async () => {
    const { service, tx } = createHarness();
    tx.encounter.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        encounterStatus: 'CONFIRMED',
        scheduledDate: new Date('2026-11-26T00:00:00.000Z'),
        scheduledTime: new Date('1970-01-01T14:00:00.000Z'),
      });

    await expect(
      service.saveVisitDraft(doctorActor, 'enc-1', {
        patientId: 'pat-1',
        exam: { chiefComplaint: 'Ho' },
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'VISIT_NOT_STARTED',
        message: expect.stringContaining('14:00'),
      }),
    });
  });

  it('(b) không tìm thấy cả hai lần vẫn ném NotFoundException', async () => {
    const { service, tx } = createHarness();
    tx.encounter.findFirst.mockResolvedValue(null);

    await expect(
      service.saveVisitDraft(doctorActor, 'enc-1', {
        patientId: 'pat-1',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('(c) visit DISPUTED ném ConflictException code VISIT_LOCKED và không ghi EMR', async () => {
    const { service, tx } = createHarness({ encounterStatus: 'DISPUTED' });

    await expect(
      service.confirmVisitRecord(doctorActor, 'enc-1', {
        patientId: 'pat-1',
        confirmed: true,
        exam: validExam,
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'VISIT_LOCKED',
      }),
    });

    expect(tx.clinicalEmr.create).not.toHaveBeenCalled();
    expect(tx.clinicalEmr.update).not.toHaveBeenCalled();
  });

  it('(d) visit IN_PROGRESS chạy bình thường', async () => {
    const { service, tx } = createHarness({ encounterStatus: 'IN_PROGRESS' });

    const res = await service.saveVisitDraft(doctorActor, 'enc-1', {
      patientId: 'pat-1',
      exam: { chiefComplaint: 'Ho' },
    });

    expect(res.emrId).toBe('emr-1');
    expect(tx.clinicalEmr.create).toHaveBeenCalled();
  });
});

describe('Task 8: Validate ICD-10 ở PrescriptionExamDto (cho phép nhóm U)', () => {
  it.each(['U07.1', 'J06.9', 'Z00'])('chấp nhận mã hợp lệ %s', async (icd10Code) => {
    const dto = plainToInstance(ConfirmVisitRecordDto, {
      patientId: '9b44a2a0-2f8d-4bb4-8b2d-f7640e8d0c7e',
      confirmed: true,
      exam: { ...validExam, icd10Code },
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it.each(['123', 'J6', 'J06.12345'])('từ chối mã sai định dạng %s', async (icd10Code) => {
    const dto = plainToInstance(ConfirmVisitRecordDto, {
      patientId: '9b44a2a0-2f8d-4bb4-8b2d-f7640e8d0c7e',
      confirmed: true,
      exam: { ...validExam, icd10Code },
    });
    const errors = await validate(dto);
    const examError = errors.find((e) => e.property === 'exam');
    expect(examError?.children?.some((c) => c.property === 'icd10Code')).toBe(true);
  });
});
