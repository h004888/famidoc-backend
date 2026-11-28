import { Prisma } from '@prisma/client';
import { MedicalBooksService } from '../services/medical-books.service';

const doctorActor = {
  id: 'doc-user-1',
  role: 'DOCTOR',
  familyUnitId: null,
} as any;

describe('Task 7: MedicalBooksService.visitDetail mở rộng MS 15/BV1', () => {
  it('trả về diagnoses[], homeMedications[], các trường MS 15/BV1, vitals.heightCm, followUpDate, progression và chi tiết đơn nối tiếp', async () => {
    const recordedAt = new Date('2026-11-27T09:00:00.000Z');
    const followUpDate = new Date('2026-12-10T00:00:00.000Z');

    const visit = {
      id: 'enc-1',
      encounterType: 'HOME_VISIT',
      visitScope: 'FAMILY',
      scheduledDate: new Date('2026-11-27T00:00:00.000Z'),
      scheduledTime: new Date('1970-01-01T08:30:00.000Z'),
      participants: [
        {
          patient: {
            id: 'pat-1',
            fullName: 'Nguyễn Văn A',
            dateOfBirth: new Date('1960-05-10'),
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
      clinicalEmrs: [
        {
          id: 'emr-1',
          patientId: 'pat-1',
          patient: {
            id: 'pat-1',
            fullName: 'Nguyễn Văn A',
            dateOfBirth: new Date('1960-05-10'),
            relationshipToHead: 'SELF',
            familyId: 'fam-1',
            gender: 'MALE',
          },
          chiefComplaint: 'Đau đầu, chóng mặt',
          anamnesis: 'Khởi phát 3 ngày nay',
          informantName: 'Nguyễn Thị B',
          informantRelation: 'Vợ',
          personalHistory: 'Tăng huyết áp 5 năm',
          familyHistory: 'Bố đẻ tăng huyết áp',
          medicationAdherence: 'Uống đều buổi sáng',
          generalExam: 'Tỉnh, tiếp xúc tốt',
          clinicalFindings: 'Tim đều, phổi không ran',
          icd10Code: 'I10',
          icd10Diagnosis: 'Tăng huyết áp vô căn',
          treatmentPlan: 'Tiếp tục kiểm soát huyết áp, giảm muối',
          selfCareNotes: 'Đo huyết áp 2 lần/ngày',
          progression: 'IMPROVED',
          followUpDate,
          isFinalized: true,
          finalizedAt: recordedAt,
          diagnoses: [
            {
              id: 'diag-1',
              icd10Code: 'I10',
              nameSnapshot: 'Tăng huyết áp vô căn',
              isPrimary: true,
              lineNumber: 0,
            },
            {
              id: 'diag-2',
              icd10Code: 'J06.9',
              nameSnapshot: 'Nhiễm khuẩn hô hấp trên cấp',
              isPrimary: false,
              lineNumber: 1,
            },
          ],
          homeMedications: [
            {
              id: 'hm-1',
              medicationName: 'Amlodipine 5mg',
              source: 'PRESCRIBED',
              assessment: 'ADHERENT',
              notes: 'Uống sau ăn sáng',
              lineNumber: 0,
            },
          ],
          vitalSigns: [
            {
              systolicBp: 135,
              diastolicBp: 85,
              heartRate: 76,
              temperature: new Prisma.Decimal('36.6'),
              spo2: 98,
              respiratoryRate: 18,
              weightKg: new Prisma.Decimal('64.0'),
              heightCm: new Prisma.Decimal('152.5'),
              recordedAt,
            },
          ],
          prescriptions: [
            {
              id: 'rx-1',
              prescriptionCode: 'RX-2026-001',
              status: 'ISSUED',
              instructions: 'Uống đủ nước',
              clinicalContext: null,
              prescribedDate: new Date('2026-11-27'),
              validUntil: new Date('2026-12-27'),
              recordSnapshot: null,
              replacementReason: 'Tái khám tại nhà ngày 27/11/2026',
              discontinuedMedications: [
                { medicationName: 'Paracetamol 500mg', reason: 'Hết sốt' },
              ],
              replaces: { id: 'rx-0', prescriptionCode: 'RX-2026-000' },
              replacedBy: null,
              details: [
                {
                  id: 'det-1',
                  medicationName: 'Amlodipine',
                  medicationCode: 'AML5',
                  activeIngredient: 'Amlodipine',
                  medicationType: 'SINGLE_INGREDIENT',
                  strength: '5mg',
                  administrationRoute: 'Uống',
                  dosage: '1 viên',
                  quantity: 30,
                  unit: 'Viên',
                  frequency: 'Sáng 1 viên',
                  durationDays: 30,
                  changeType: 'DOSE_CHANGED',
                },
              ],
            },
          ],
        },
      ],
    };

    const activeRx = {
      id: 'rx-prev',
      prescriptionCode: 'RX-2026-PREV',
      status: 'ISSUED',
      prescribedDate: new Date('2026-10-27T00:00:00.000Z'),
      validUntil: new Date('2026-11-01T00:00:00.000Z'),
      details: [{ id: 'd-prev', medicationName: 'Amlodipine (Amlor)' }],
    };
    const prisma: any = {
      encounter: { findFirst: jest.fn().mockResolvedValue(visit) },
      vitalSign: { findFirst: jest.fn().mockResolvedValue(null) },
      prescription: { findFirst: jest.fn().mockResolvedValue(activeRx) },
      auditLog: { create: jest.fn().mockResolvedValue({ id: 'audit-1' }) },
    };

    const service = new MedicalBooksService(prisma, {} as any);
    const result: any = await service.visitDetail(doctorActor, 'enc-1', 'pat-1');

    expect(result.diagnoses).toHaveLength(2);
    expect(result.diagnoses[0]).toMatchObject({
      icd10Code: 'I10',
      isPrimary: true,
    });
    expect(result.homeMedications).toHaveLength(1);
    expect(result.homeMedications[0]).toMatchObject({
      medicationName: 'Amlodipine 5mg',
    });
    expect(result.exam).toMatchObject({
      chiefComplaint: 'Đau đầu, chóng mặt',
      anamnesis: 'Khởi phát 3 ngày nay',
      informantName: 'Nguyễn Thị B',
      informantRelation: 'Vợ',
      personalHistory: 'Tăng huyết áp 5 năm',
      familyHistory: 'Bố đẻ tăng huyết áp',
      medicationAdherence: 'Uống đều buổi sáng',
      generalExam: 'Tỉnh, tiếp xúc tốt',
      selfCareNotes: 'Đo huyết áp 2 lần/ngày',
    });
    expect(result.followUpDate).toEqual(followUpDate);
    expect(result.progression).toBe('IMPROVED');
    expect(result.vitals.heightCm).toBe(152.5);
    expect(result.prescription.details[0].changeType).toBe('DOSE_CHANGED');
    expect(result.prescription.discontinuedMedications).toEqual([
      { medicationName: 'Paracetamol 500mg', reason: 'Hết sốt' },
    ]);
  });

  it('trả về activePrescription = đơn ISSUED gần nhất ở lần khám trước, chưa bị thay (để kê đơn nối tiếp)', async () => {
    const visit = {
      id: 'enc-2',
      encounterType: 'HOME_VISIT',
      visitScope: 'FAMILY',
      scheduledDate: new Date('2026-11-27T00:00:00.000Z'),
      scheduledTime: new Date('1970-01-01T08:30:00.000Z'),
      participants: [
        {
          patient: {
            id: 'pat-1',
            fullName: 'Nguyễn Văn A',
            dateOfBirth: new Date('1960-05-10'),
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
      clinicalEmrs: [],
    };
    const activeRx = {
      id: 'rx-prev',
      prescriptionCode: 'RX-2026-PREV',
      status: 'ISSUED',
      prescribedDate: new Date('2026-10-27T00:00:00.000Z'),
      validUntil: new Date('2026-11-01T00:00:00.000Z'),
      details: [{ id: 'd-prev', medicationName: 'Amlodipine (Amlor)' }],
    };
    const prisma: any = {
      encounter: { findFirst: jest.fn().mockResolvedValue(visit) },
      vitalSign: { findFirst: jest.fn().mockResolvedValue(null) },
      prescription: { findFirst: jest.fn().mockResolvedValue(activeRx) },
      auditLog: { create: jest.fn().mockResolvedValue({ id: 'audit-1' }) },
    };

    const service = new MedicalBooksService(prisma, {} as any);
    const result: any = await service.visitDetail(doctorActor, 'enc-2', 'pat-1');

    expect(result.prescription).toBeNull();
    expect(result.activePrescription).toEqual(activeRx);
    const where = prisma.prescription.findFirst.mock.calls[0][0].where;
    expect(where).toMatchObject({
      status: 'ISSUED',
      replacedBy: { is: null },
      clinicalEmr: { patientId: 'pat-1', encounterId: { not: 'enc-2' } },
    });
  });

  it('lần ngược chuỗi replaces từ lần khám trước vào prescriptionHistory (Màn 6)', async () => {
    const visit = {
      id: 'enc-3',
      encounterType: 'HOME_VISIT',
      visitScope: 'FAMILY',
      scheduledDate: new Date('2026-11-28T00:00:00.000Z'),
      scheduledTime: new Date('1970-01-01T08:30:00.000Z'),
      participants: [
        {
          patient: {
            id: 'pat-1',
            fullName: 'Nguyễn Văn A',
            dateOfBirth: new Date('1960-05-10'),
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
      clinicalEmrs: [
        {
          id: 'emr-3',
          patientId: 'pat-1',
          patient: {
            id: 'pat-1',
            fullName: 'Nguyễn Văn A',
            dateOfBirth: new Date('1960-05-10'),
            relationshipToHead: 'SELF',
            familyId: 'fam-1',
            gender: 'MALE',
          },
          chiefComplaint: 'Tái khám',
          clinicalFindings: 'Ổn định',
          icd10Code: 'I10',
          icd10Diagnosis: 'Tăng huyết áp',
          treatmentPlan: 'Duy trì thuốc',
          isFinalized: true,
          finalizedAt: new Date('2026-11-28T09:00:00.000Z'),
          diagnoses: [],
          homeMedications: [],
          vitalSigns: [],
          prescriptions: [
            {
              id: 'rx-new',
              prescriptionCode: 'FMD-NEW',
              status: 'ISSUED',
              instructions: null,
              clinicalContext: null,
              prescribedDate: new Date('2026-11-28'),
              validUntil: new Date('2026-12-03'),
              recordSnapshot: null,
              discontinuedMedications: null,
              replacementReason: 'Tái khám tại nhà ngày 2026-11-28',
              replaces: { id: 'rx-prev', prescriptionCode: 'FMD-PREV' },
              replacedBy: null,
              details: [],
            },
          ],
        },
      ],
    };

    const prevRx = {
      id: 'rx-prev',
      prescriptionCode: 'FMD-PREV',
      status: 'ISSUED',
      instructions: null,
      clinicalContext: null,
      prescribedDate: new Date('2026-11-05'),
      validUntil: new Date('2026-11-10'),
      recordSnapshot: null,
      discontinuedMedications: null,
      replacementReason: null,
      replaces: null,
      replacedBy: { id: 'rx-new', prescriptionCode: 'FMD-NEW' },
      details: [{ id: 'd-1', medicationName: 'Amlodipin 5mg', durationDays: 30, changeType: 'NEW' }],
    };

    const prisma: any = {
      encounter: { findFirst: jest.fn().mockResolvedValue(visit) },
      vitalSign: { findFirst: jest.fn().mockResolvedValue(null) },
      prescription: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(prevRx),
      },
      auditLog: { create: jest.fn().mockResolvedValue({ id: 'audit-1' }) },
    };

    const service = new MedicalBooksService(prisma, {} as any);
    const result: any = await service.visitDetail(doctorActor, 'enc-3', 'pat-1');

    expect(result.prescription.id).toBe('rx-new');
    expect(result.prescriptionHistory).toHaveLength(1);
    expect(result.prescriptionHistory[0]).toMatchObject({
      id: 'rx-prev',
      prescriptionCode: 'FMD-PREV',
    });
    expect(prisma.prescription.findFirst).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'rx-prev',
          clinicalEmr: { patientId: 'pat-1' },
        }),
      }),
    );
  });
});
