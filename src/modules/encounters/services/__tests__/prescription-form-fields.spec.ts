import { ValidationPipe } from '@nestjs/common';
import type { PrismaService } from '../../../../core/database/prisma.service';
import { PrescriptionInputDto } from '../../dtos/share-prescription.dto';
import { PrescriptionsService } from '../prescriptions.service';

const recipientId = '10000000-0000-4000-8000-000000000001';
const details = [
  {
    medicationName: 'Tên thuốc đã nhập',
    strength: '500mg',
    administrationRoute: 'Uống',
    dosage: '1 viên',
    frequency: 'Sau ăn',
    quantity: 6,
    unit: 'Viên',
    durationDays: 3,
    medicationCode: 'TH-01',
    activeIngredient: 'Hoạt chất đã nhập',
  },
];
const clinicalContext = {
  weightKg: 25.5,
  address: 'Địa chỉ đã nhập',
  phone: '0901234567',
  treatmentMode: 'OUTPATIENT' as const,
  followUpDays: 7,
};
const exam = {
  chiefComplaint: 'Đau',
  clinicalFindings: 'Kết quả',
  icd10Code: 'I10',
  icd10Diagnosis: 'Tăng huyết áp',
  treatmentPlan: 'Theo dõi',
};
const patient = {
  id: 'patient-1',
  fullName: 'Người bệnh',
  familyId: 'family-1',
  dateOfBirth: new Date('1990-01-01'),
  gender: 'MALE',
};
const doctor = {
  doctorName: 'Bác sĩ',
  user: { phone: '0900000001' },
  facility: { facilityName: 'CSYT', address: 'Địa chỉ CSYT' },
};

describe('Prescription form fields', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  const metadata = { type: 'body' as const, metatype: PrescriptionInputDto };

  it('validates additional fields and still accepts prescriptions without them', async () => {
    const body = {
      details,
      clinicalContext,
      recipientUserId: recipientId,
      recipientAuthorized: true,
    };
    await expect(pipe.transform(body, metadata)).resolves.toMatchObject(body);
    await expect(
      pipe.transform({ ...body, clinicalContext: undefined }, metadata),
    ).resolves.toBeDefined();
    await expect(
      pipe.transform({ ...body, clinicalContext: { weightKg: -1 } }, metadata),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      pipe.transform(
        { ...body, clinicalContext: { citizenId: 'wrong' } },
        metadata,
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      pipe.transform(
        { ...body, clinicalContext: { followUpDays: 1.5 } },
        metadata,
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it.each([false, true])(
    'reuses existing exam data when finalized=%s',
    async (isFinalized) => {
      const create = jest
        .fn()
        .mockResolvedValue({ id: 'rx-1', prescriptionCode: 'FMD-visit-1' });
      const session = {
        encounter: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'visit-1',
            participants: [{ patient }],
            doctor,
            contract: {
              familyId: 'family-1',
              familyUnit: {
                representativeUser: {
                  id: recipientId,
                  status: 'ACTIVE',
                  role: 'FAMILY_REP',
                },
              },
            },
            clinicalEmrs: [
              { id: 'emr-1', patientId: patient.id, patient, isFinalized, prescriptions: [] },
            ],
          }),
        },
        prescription: { create },
        clinicalEmr: { findUniqueOrThrow: jest.fn().mockResolvedValue({ ...exam, patient }) },
        notification: { create: jest.fn() },
        auditLog: { create: jest.fn() },
      };
      const service = new PrescriptionsService({
        $transaction: (work: (tx: unknown) => unknown) => work(session),
      } as unknown as PrismaService);
      await service.share(
        { id: 'doctor-1', role: 'DOCTOR', familyUnitId: null },
        'visit-1',
        {
          details,
          clinicalContext,
          recipientUserId: recipientId,
          recipientAuthorized: true,
        },
      );
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            clinicalContext: expect.objectContaining(clinicalContext),
            details: {
              create: [
                expect.objectContaining({
                  medicationCode: 'TH-01',
                  activeIngredient: 'Hoạt chất đã nhập',
                  medicationName: 'Hoạt chất đã nhập (Tên thuốc đã nhập)',
                }),
              ],
            },
          }),
        }),
      );
    },
  );

  it('sends separate prescriptions for members in the same visit', async () => {
    const patients = [patient, { ...patient, id: 'patient-2', fullName: 'Người bệnh thứ hai' }];
    const clinicalEmrs = patients.map((member) => ({
      id: 'emr-' + member.id,
      patientId: member.id,
      patient: member,
      isFinalized: true,
      prescriptions: [],
    }));
    const findFirst = jest.fn().mockImplementation(async ({ where }) => ({
      id: where.id,
      participants: patients.map((member) => ({ patient: member })),
      doctor,
      contract: {
        familyId: 'family-1',
        familyUnit: {
          representativeUser: {
            id: recipientId,
            role: 'FAMILY_REP',
            status: 'ACTIVE',
          },
        },
      },
      clinicalEmrs,
    }));
    const create = jest.fn().mockImplementation(async ({ data }) => ({
      id: data.emrId,
      prescriptionCode: data.prescriptionCode,
    }));
    const tx = {
      encounter: { findFirst },
      prescription: { create },
      clinicalEmr: {
        findUniqueOrThrow: jest.fn().mockImplementation(async ({ where }) => ({
          ...exam,
          patient: clinicalEmrs.find(({ id }) => id === where.id)!.patient,
        })),
      },
      notification: { create: jest.fn() },
      auditLog: { create: jest.fn() },
    };
    const transaction = jest.fn().mockImplementation(async (work) => work(tx));
    const service = new PrescriptionsService({
      $transaction: transaction,
    } as unknown as PrismaService);
    const input = {
      prescriptions: [1, 2].map((index) => ({
        encounterId: 'visit-1',
        patientId: `patient-${index}`,
        recipientUserId: recipientId,
        recipientAuthorized: true as const,
        details: [{ ...details[0], medicationName: `Thuốc người ${index}` }],
        clinicalContext,
      })),
    };
    const result = await service.prescribeFamily(
      { id: 'doctor-1', role: 'DOCTOR', familyUnitId: null },
      'family-1',
      input,
    );
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ isolationLevel: 'Serializable' }),
    );
    expect(result.items.map(({ patientId }) => patientId)).toEqual([
      'patient-1',
      'patient-2',
    ]);
    expect(
      create.mock.calls.map(([{ data }]) => [
        data.emrId,
        data.details.create[0].medicationName,
      ]),
    ).toEqual([
      ['emr-patient-1', 'Hoạt chất đã nhập (Thuốc người 1)'],
      ['emr-patient-2', 'Hoạt chất đã nhập (Thuốc người 2)'],
    ]);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          contract: { familyId: 'family-1' },
          doctor: expect.objectContaining({ userId: 'doctor-1' }),
        }),
      }),
    );

    findFirst.mockResolvedValueOnce({
      id: 'visit-1',
      participants: [],
      clinicalEmrs: [],
      contract: { familyId: 'other-family' },
    });
    create.mockClear();
    await expect(
      service.prescribeFamily(
        { id: 'doctor-1', role: 'DOCTOR', familyUnitId: null },
        'family-1',
        input,
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(create).not.toHaveBeenCalled();
  });
});
