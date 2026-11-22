import { PrescriptionsService } from '../services/prescriptions.service';

describe('PrescriptionsService multi-member family visit', () => {
  it('cho phép xác nhận bệnh án và tạo mã đơn thuốc riêng theo từng thành viên trong cùng một buổi khám', async () => {
    const createdEmrs: Array<{ id: string; encounterId: string; patientId: string }> = [];
    const createdPrescriptions: Array<{ emrId: string; prescriptionCode: string }> = [];

    const exam = {
      chiefComplaint: 'Khám định kỳ',
      clinicalFindings: 'Ổn định',
      icd10Code: 'Z00',
      icd10Diagnosis: 'Khám sức khỏe tổng quát',
      treatmentPlan: 'Theo dõi định kỳ',
    };
    const patients = [
      { id: 'pat-1', fullName: 'Thành viên 1' },
      { id: 'pat-2', fullName: 'Thành viên 2' },
    ].map((patient) => ({
      ...patient,
      familyId: 'fam-1',
      dateOfBirth: new Date('1990-01-01'),
      gender: 'MALE',
    }));

    const mockTx: any = {
      encounter: {
        findFirst: jest.fn().mockImplementation(async () => ({
          id: 'enc-family-1',
          encounterType: 'HOME_VISIT',
          scheduledDate: new Date('2026-11-21T00:00:00.000Z'),
          scheduledTime: new Date('1970-01-01T08:30:00.000Z'),
          participants: patients.map((patient) => ({ patient })),
          doctor: {
            doctorName: 'Bác sĩ',
            user: { phone: '0901234567' },
            facility: { facilityName: 'CSYT', address: 'Địa chỉ CSYT' },
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
          clinicalEmrs: createdEmrs.map((e) => ({
            ...e,
            isFinalized: true,
            prescriptions: [],
          })),
        })),
      },
      patient: {
        findFirst: jest.fn().mockImplementation(async ({ where }: any) => {
          if (where.id === 'pat-1' || where.id === 'pat-2') {
            return { id: where.id };
          }
          return null;
        }),
      },
      clinicalEmr: {
        findUniqueOrThrow: jest.fn().mockImplementation(async ({ where }) => {
          const record = createdEmrs.find(({ id }) => id === where.id);
          return { ...exam, patient: patients.find(({ id }) => id === record?.patientId) };
        }),
        create: jest.fn().mockImplementation(async ({ data }: any) => {
          const record = {
            id: `emr-${data.patientId}`,
            encounterId: data.encounterId,
            patientId: data.patientId,
          };
          createdEmrs.push(record);
          return record;
        }),
      },
      prescription: {
        create: jest.fn().mockImplementation(async ({ data }: any) => {
          const rec = {
            id: `rx-${data.emrId}`,
            emrId: data.emrId,
            prescriptionCode: data.prescriptionCode,
          };
          createdPrescriptions.push(rec);
          return rec;
        }),
      },
      notification: { create: jest.fn().mockResolvedValue(undefined) },
      auditLog: { create: jest.fn().mockResolvedValue(undefined) },
    };

    const mockPrisma: any = {
      $transaction: jest.fn().mockImplementation(async (fn: any) => fn(mockTx)),
    };

    const service = new PrescriptionsService(mockPrisma);
    const doctorActor: any = { id: 'doc-user-1', role: 'DOCTOR' };
    const prescription = {
      recipientUserId: 'rep-1',
      recipientAuthorized: true as const,
      instructions: 'Uống sau ăn',
      clinicalContext: { address: 'Địa chỉ mẫu', phone: '0901234567' },
      details: [
        {
          medicationName: 'Tên thuốc mẫu',
          activeIngredient: 'Hoạt chất mẫu',
          dosage: '1 viên',
          frequency: '1 lần/ngày',
          quantity: 10,
          unit: 'viên',
          durationDays: 10,
        },
      ],
    };

    await service.confirmVisitRecord(doctorActor, 'enc-family-1', {
      patientId: 'pat-1',
      confirmed: true,
      exam,
      prescription,
    });

    await service.confirmVisitRecord(doctorActor, 'enc-family-1', {
      patientId: 'pat-2',
      confirmed: true,
      exam,
      prescription,
    });

    expect(createdEmrs).toHaveLength(2);
    expect(createdPrescriptions.map((p) => p.emrId)).toEqual([
      'emr-pat-1',
      'emr-pat-2',
    ]);
    expect(new Set(createdPrescriptions.map((p) => p.prescriptionCode)).size).toBe(2);
    expect(
      mockTx.prescription.create.mock.calls.map(([{ data }]) => data.recordSnapshot.patient.id),
    ).toEqual(['pat-1', 'pat-2']);
  });
});
