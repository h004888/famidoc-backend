import { ValidationPipe } from '@nestjs/common';
import { BaseApiException } from '../../../../core/exceptions/api.exception';
import type { PrismaService } from '../../../../core/database/prisma.service';
import {
  ReplacePrescriptionDto,
  SharePrescriptionDto,
} from '../../dtos/share-prescription.dto';
import {
  eligibleForLongTermPrescription,
  patientAgeMonths,
} from '../../prescription-rules';
import { PrescriptionsService } from '../prescriptions.service';

const actor = { id: 'doctor-1', role: 'DOCTOR', familyUnitId: null } as const;
const context = { address: 'Nơi cư trú', phone: '0901234567' };
const drug = {
  medicationName: 'Tên thương mại',
  activeIngredient: 'Hoạt chất',
  strength: '500mg',
  dosage: '1 viên',
  administrationRoute: 'Uống',
  frequency: '2 lần/ngày sau ăn',
  quantity: 6,
  unit: 'Viên',
  durationDays: 3,
};
const body = {
  details: [drug],
  clinicalContext: context,
  recipientUserId: '10000000-0000-4000-8000-000000000001',
  recipientAuthorized: true as const,
};
const exam = {
  chiefComplaint: 'Lý do',
  clinicalFindings: 'Thăm khám',
  icd10Code: 'I10',
  icd10Diagnosis: 'Tăng huyết áp',
  treatmentPlan: 'Theo dõi',
};

function setup() {
  const patient = {
      id: 'patient-1',
      familyId: 'family-1',
      fullName: 'Tên lúc kê',
      dateOfBirth: new Date('1990-01-01'),
      gender: 'MALE',
  };
  const visit = {
    id: 'visit-1',
    participants: [{ patient }],
    doctor: {
      doctorName: 'BS lúc kê',
      user: { phone: '0900000001' },
      facility: { facilityName: 'CSYT lúc kê', address: 'Địa chỉ CSYT' },
    },
    contract: {
      familyId: 'family-1',
      familyUnit: {
        representativeUser: {
          id: body.recipientUserId,
          role: 'FAMILY_REP',
          status: 'ACTIVE',
        },
      },
    },
    clinicalEmrs: [{
      patient,
      patientId: patient.id,
      id: 'emr-1',
      isFinalized: true,
      prescriptions: [] as { id: string }[],
    }],
  };
  const tx = {
    encounter: { findFirst: jest.fn().mockResolvedValue(visit) },
    clinicalEmr: { findUniqueOrThrow: jest.fn().mockResolvedValue({ ...exam, patient }) },
    prescription: {
      create: jest.fn().mockImplementation(async ({ data }) => ({
        id: 'rx-new',
        prescriptionCode: data.prescriptionCode,
      })),
      findFirst: jest.fn().mockResolvedValue({
        id: 'rx-old',
        emrId: 'emr-1',
        status: 'ISSUED',
        clinicalEmr: { encounterId: visit.id },
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    notification: { create: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn(async (work) => work(tx)),
    prescription: tx.prescription,
    auditLog: tx.auditLog,
  };
  return {
    visit,
    tx,
    prisma,
    service: new PrescriptionsService(prisma as unknown as PrismaService),
  };
}

describe('Prescription safety and versions', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });

  it.each([0, 91, 365, 1.5])(
    'rejects invalid duration %s through the API DTO',
    async (durationDays) => {
      await expect(
        pipe.transform(
          { ...body, details: [{ ...drug, durationDays }] },
          { type: 'body', metatype: SharePrescriptionDto },
        ),
      ).rejects.toMatchObject({ status: 400 });
    },
  );

  it.each([
    { ...context, address: ' ' },
    { ...context, phone: '' },
  ])('requires patient residence and contact', async (clinicalContext) => {
    const { service, tx } = setup();
    await expect(
      service.share(actor, 'visit-1', { ...body, clinicalContext }),
    ).rejects.toMatchObject({
      status: 422,
      errorCode: 'VALIDATION_FAILED',
    });
    expect(tx.prescription.create).not.toHaveBeenCalled();
  });

  it('requires weight and caregiver for a child, derives age from the stored birthday', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-21T00:00:00Z'));
    try {
      const { service, visit, tx } = setup();
      visit.participants[0].patient.dateOfBirth = new Date('2025-01-22');
      await expect(service.share(actor, visit.id, body)).rejects.toMatchObject({
        status: 422,
        errorCode: 'VALIDATION_FAILED',
        invalidParams: [
          expect.objectContaining({ field: 'prescription.clinicalContext.weightKg' }),
        ],
      });
      await service.share(actor, visit.id, {
        ...body,
        clinicalContext: {
          ...context,
          weightKg: 10,
          caregiverName: 'Người đưa trẻ',
          ageMonths: 999,
        },
      });
      expect(
        tx.prescription.create.mock.calls[0][0].data.clinicalContext.ageMonths,
      ).toBe(21);
    } finally {
      jest.useRealTimers();
    }
  });

  it('allows 90 days only with an eligible diagnosis and a clinical reason', async () => {
    const { service, visit, tx } = setup();
    const longBody = { ...body, details: [{ ...drug, durationDays: 90 }] };
    await expect(
      service.share(actor, 'visit-1', longBody),
    ).rejects.toMatchObject({ status: 400 });
    const valid = {
      ...longBody,
      clinicalContext: {
        ...context,
        longTermReason: 'Bệnh ổn định, điều trị theo phác đồ phù hợp.',
      },
    };
    await service.share(actor, 'visit-1', valid);
    tx.clinicalEmr.findUniqueOrThrow.mockResolvedValue({
      ...exam,
      patient: visit.participants[0].patient,
      icd10Code: 'J00',
    });
    await expect(service.share(actor, 'visit-1', valid)).rejects.toMatchObject({
      status: 400,
    });
  });

  it('checks excluded diabetes codes and child month boundaries', () => {
    expect(eligibleForLongTermPrescription('E11.0')).toBe(false);
    expect(eligibleForLongTermPrescription('E11.1')).toBe(false);
    expect(eligibleForLongTermPrescription('E11.9')).toBe(true);
    expect(eligibleForLongTermPrescription('I10;J00')).toBe(false);
    expect(patientAgeMonths('2020-11-22', '2026-11-21')).toBe(71);
    expect(patientAgeMonths('2020-11-21', '2026-11-21')).toBe(72);
    expect(patientAgeMonths('2027-01-01', '2026-11-21')).toBeNull();
    expect(patientAgeMonths(null, '2026-11-21')).toBeNull();
    expect(patientAgeMonths(undefined, '2026-11-21')).toBeNull();
    expect(patientAgeMonths('', '2026-11-21')).toBeNull();
  });

  it('captures the original header and computes expiry from prescription creation day', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-20T18:00:00Z'));
    try {
      const { service, tx } = setup();
      await service.share(actor, 'visit-1', body);
      const saved = tx.prescription.create.mock.calls[0][0].data;
      expect(saved.prescribedDate.toISOString()).toBe(
        '2026-11-21T00:00:00.000Z',
      );
      expect(saved.validUntil.toISOString()).toBe('2026-11-26T00:00:00.000Z');
      expect(saved.recordSnapshot).toMatchObject({
        patient: { fullName: 'Tên lúc kê' },
        doctorName: 'BS lúc kê',
        exam,
      });
      expect(saved.details.create[0].medicationName).toBe(
        'Hoạt chất (Tên thương mại)',
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('replaces atomically with a new code while retaining the original content', async () => {
    const { service, tx, prisma, visit } = setup();
    visit.clinicalEmrs[0].prescriptions = [{ id: 'rx-old' }];
    const replacement = {
      ...body,
      replacementReason: 'Thay đổi theo kết quả tái đánh giá.',
    };
    await service.replace(actor, 'rx-old', replacement);
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ isolationLevel: 'Serializable' }),
    );
    expect(tx.prescription.create.mock.calls[0][0].data).toMatchObject({
      replacesPrescriptionId: 'rx-old',
      replacementReason: replacement.replacementReason,
    });
    expect(tx.prescription.updateMany).toHaveBeenCalledWith({
      where: { id: 'rx-old', status: { not: 'CANCELLED' } },
      data: { status: 'CANCELLED', cancelledAt: expect.any(Date) },
    });
    expect(tx.notification.create).toHaveBeenCalled();
    expect(
      tx.prescription.create.mock.calls[0][0].data.prescriptionCode,
    ).not.toBe('FMD-visit-1');
  });

  it('rejects replacing another doctor’s or an already replaced prescription', async () => {
    const { service, tx } = setup();
    const replacement = {
      ...body,
      replacementReason: 'Thay đổi theo kết quả tái đánh giá.',
    };
    tx.prescription.findFirst.mockResolvedValueOnce(null);
    await expect(
      service.replace(actor, 'rx-other', replacement),
    ).rejects.toMatchObject({ status: 404 });
    tx.prescription.findFirst.mockResolvedValueOnce({
      id: 'rx-old',
      emrId: 'emr-1',
      status: 'CANCELLED',
      clinicalEmr: { encounterId: 'visit-1' },
    });
    await expect(
      service.replace(actor, 'rx-old', replacement),
    ).rejects.toMatchObject({ status: 409 });
    expect(tx.prescription.create).not.toHaveBeenCalled();
  });

  it('requires a replacement reason and rejects unsupported controlled medication types', async () => {
    await expect(
      pipe.transform(
        { ...body, replacementReason: ' ' },
        { type: 'body', metatype: ReplacePrescriptionDto },
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      pipe.transform(
        { ...body, details: [{ ...drug, medicationType: 'CONTROLLED' }] },
        { type: 'body', metatype: SharePrescriptionDto },
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects prescribing with PATIENT_PROFILE_INCOMPLETE when dateOfBirth is null', async () => {
    const { service, tx } = setup();
    const visit = await tx.encounter.findFirst();
    visit.participants[0].patient.dateOfBirth = null;
    tx.clinicalEmr.findUniqueOrThrow.mockResolvedValue({
      ...exam,
      patient: visit.participants[0].patient,
    });

    const err = await service.share(actor, 'visit-1', body).catch((e) => e);
    expect(err).toBeInstanceOf(BaseApiException);
    expect(err).toMatchObject({
      errorCode: 'PATIENT_PROFILE_INCOMPLETE',
      conditions: [expect.objectContaining({ code: 'DOB_REQUIRED' })],
    });
  });

  it('allows prescribing when gender is null and records gender: null in snapshot', async () => {
    const { service, tx } = setup();
    const visit = await tx.encounter.findFirst();
    visit.participants[0].patient.gender = null;
    tx.clinicalEmr.findUniqueOrThrow.mockResolvedValue({
      ...exam,
      patient: visit.participants[0].patient,
    });

    await service.share(actor, 'visit-1', body);
    const saved = tx.prescription.create.mock.calls[0][0].data;
    expect(saved.recordSnapshot.patient.gender).toBeNull();
  });
});
