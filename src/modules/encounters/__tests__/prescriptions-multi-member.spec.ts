import { PrescriptionsService } from '../services/prescriptions.service';

describe('PrescriptionsService multi-member family visit', () => {
  it('cho phép xác nhận bệnh án và tạo mã đơn thuốc riêng theo từng thành viên trong cùng một buổi khám', async () => {
    const createdEmrs: Array<{ id: string; encounterId: string; patientId: string }> = [];
    const createdPrescriptions: Array<{ emrId: string; prescriptionCode: string }> = [];

    const mockTx: any = {
      encounter: {
        findFirst: jest.fn().mockImplementation(async () => ({
          id: 'enc-family-1',
          encounterType: 'HOME_VISIT',
          scheduledDate: new Date('2026-11-21T00:00:00.000Z'),
          scheduledTime: new Date('1970-01-01T08:30:00.000Z'),
          participants: [
            { patient: { id: 'pat-1', fullName: 'Thành viên 1', familyId: 'fam-1' } },
            { patient: { id: 'pat-2', fullName: 'Thành viên 2', familyId: 'fam-1' } },
          ],
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
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
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
    const exam = {
      chiefComplaint: 'Khám định kỳ',
      clinicalFindings: 'Ổn định',
      icd10Code: 'Z00',
      icd10Diagnosis: 'Khám sức khỏe tổng quát',
      treatmentPlan: 'Theo dõi định kỳ',
    };
    const prescription = {
      recipientUserId: 'rep-1',
      recipientAuthorized: true as const,
      instructions: 'Uống sau ăn',
      details: [
        {
          medicationName: 'Vitamin C',
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
    expect(createdPrescriptions.map((p) => p.prescriptionCode)).toEqual([
      'FMD-emr-pat-1',
      'FMD-emr-pat-2',
    ]);
  });
});
