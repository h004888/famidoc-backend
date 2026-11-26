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
      encounterParticipant: {
        upsert: jest.fn().mockResolvedValue({}),
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

  describe('confirmVisitRecord (Dual-Lane reconciliation)', () => {
    const exam = {
      chiefComplaint: 'Khám định kỳ',
      clinicalFindings: 'Ổn định',
      icd10Code: 'Z00',
      icd10Diagnosis: 'Khám sức khỏe tổng quát',
      treatmentPlan: 'Theo dõi định kỳ',
    };
    const doctorActor: any = { id: 'doc-user-1', role: 'DOCTOR' };

    const buildMockPrisma = (encounterOverrides: Record<string, any>) => {
      const mockTx: any = {
        encounter: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'enc-1',
            encounterType: 'HOME_VISIT',
            encounterStatus: 'CONFIRMED',
            familyConfirmedArrivalAt: null,
            scheduledDate: new Date('2026-11-21T00:00:00.000Z'),
            scheduledTime: new Date('1970-01-01T08:30:00.000Z'),
            participants: [{ patient: { id: 'pat-1', fullName: 'Bệnh nhân 1', familyId: 'fam-1' } }],
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
            clinicalEmrs: [],
            ...encounterOverrides,
          }),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        patient: {
          findFirst: jest.fn().mockResolvedValue({ id: 'pat-1' }),
        },
        clinicalEmr: {
          create: jest.fn().mockResolvedValue({ id: 'emr-1' }),
          update: jest.fn().mockResolvedValue({ id: 'emr-1' }),
        },
        encounterParticipant: {
          upsert: jest.fn().mockResolvedValue({}),
        },
        notification: { create: jest.fn().mockResolvedValue(undefined) },
        auditLog: { create: jest.fn().mockResolvedValue(undefined) },
      };
      const mockPrisma: any = {
        $transaction: jest.fn().mockImplementation(async (fn: any) => fn(mockTx)),
      };
      return { mockTx, mockPrisma };
    };

    it('HOME_VISIT ở trạng thái PENDING_RECORD: khóa ClinicalEmr, cập nhật attendanceStatus = EXAMINED, KHÔNG đóng ca và KHÔNG gửi ENCOUNTER_COMPLETED', async () => {
      const { mockTx, mockPrisma } = buildMockPrisma({
        encounterType: 'HOME_VISIT',
        encounterStatus: 'PENDING_RECORD',
        familyConfirmedArrivalAt: new Date('2026-11-21T08:35:00.000Z'),
      });
      const service = new PrescriptionsService(mockPrisma);

      await service.confirmVisitRecord(doctorActor, 'enc-1', {
        patientId: 'pat-1',
        confirmed: true,
        exam,
      });

      const whereArg = mockTx.encounter.findFirst.mock.calls[0][0].where;
      const statusList = whereArg.OR[0].encounterStatus.in;
      expect(statusList).toContain('PENDING_RECORD');
      expect(mockTx.encounterParticipant.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            encounterId_patientId: { encounterId: 'enc-1', patientId: 'pat-1' },
          },
          update: { attendanceStatus: 'EXAMINED' },
          create: expect.objectContaining({
            encounterId: 'enc-1',
            patientId: 'pat-1',
            attendanceStatus: 'EXAMINED',
          }),
        }),
      );
      expect(mockTx.encounter.updateMany).not.toHaveBeenCalled();
      expect(mockTx.notification.create).not.toHaveBeenCalled();
    });

    it('TELEHEALTH ở trạng thái PENDING_RECORD: vẫn chuyển sang COMPLETED khi bác sĩ confirmVisitRecord', async () => {
      const { mockTx, mockPrisma } = buildMockPrisma({
        encounterType: 'TELEHEALTH',
        encounterStatus: 'PENDING_RECORD',
        familyConfirmedArrivalAt: new Date('2026-11-21T08:35:00.000Z'),
      });
      const service = new PrescriptionsService(mockPrisma);

      await service.confirmVisitRecord(doctorActor, 'enc-1', {
        patientId: 'pat-1',
        confirmed: true,
        exam,
      });

      expect(mockTx.encounter.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'enc-1' }),
          data: { encounterStatus: 'COMPLETED' },
        }),
      );
      expect(mockTx.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: 'ENCOUNTER_COMPLETED' }),
        }),
      );
    });

    it('giữ nguyên CONFIRMED khi familyConfirmedArrivalAt == null (chờ gia đình hoặc job 48h)', async () => {
      const { mockTx, mockPrisma } = buildMockPrisma({
        encounterStatus: 'CONFIRMED',
        familyConfirmedArrivalAt: null,
      });
      const service = new PrescriptionsService(mockPrisma);

      await service.confirmVisitRecord(doctorActor, 'enc-1', {
        patientId: 'pat-1',
        confirmed: true,
        exam,
      });

      expect(mockTx.encounter.updateMany).not.toHaveBeenCalled();
    });

    it('giữ DISPUTED và NO_SHOW trong doctorVisitScope nhưng chặn ghi trang khám với VISIT_LOCKED', async () => {
      for (const lockedStatus of ['DISPUTED', 'NO_SHOW']) {
        const { mockTx, mockPrisma } = buildMockPrisma({
          encounterStatus: lockedStatus,
          familyConfirmedArrivalAt: null,
        });
        const service = new PrescriptionsService(mockPrisma);

        await expect(
          service.confirmVisitRecord(doctorActor, 'enc-1', {
            patientId: 'pat-1',
            confirmed: true,
            exam,
          }),
        ).rejects.toMatchObject({
          response: expect.objectContaining({ code: 'VISIT_LOCKED' }),
        });

        const whereArg = mockTx.encounter.findFirst.mock.calls[0][0].where;
        const statusList = whereArg.OR[0].encounterStatus.in;
        expect(statusList).toContain('DISPUTED');
        expect(statusList).toContain('NO_SHOW');
        expect(mockTx.encounter.updateMany).not.toHaveBeenCalled();
      }
    });
  });

  describe('saveVisitDraft', () => {
    const doctorActor: any = { id: 'doc-user-1', role: 'DOCTOR' };

    const buildDraftPrisma = (existingEmrs: any[]) => {
      const mockTx: any = {
        encounter: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'enc-1',
            encounterType: 'HOME_VISIT',
            encounterStatus: 'CONFIRMED',
            contract: { familyId: 'fam-1' },
            clinicalEmrs: existingEmrs,
          }),
        },
        patient: {
          findFirst: jest.fn().mockResolvedValue({ id: 'pat-1' }),
        },
        clinicalEmr: {
          create: jest.fn().mockResolvedValue({ id: 'emr-draft-1', isFinalized: false }),
          update: jest.fn().mockResolvedValue({ id: 'emr-draft-1', isFinalized: false }),
        },
        encounterParticipant: {
          upsert: jest.fn().mockResolvedValue({}),
        },
      };
      const mockPrisma: any = {
        $transaction: jest.fn().mockImplementation(async (fn: any) => fn(mockTx)),
      };
      return { mockTx, mockPrisma };
    };

    it('tạo mới ClinicalEmr với isFinalized = false khi chưa có bản nháp', async () => {
      const { mockTx, mockPrisma } = buildDraftPrisma([]);
      const service = new PrescriptionsService(mockPrisma) as any;

      const result = await service.saveVisitDraft(doctorActor, 'enc-1', {
        patientId: 'pat-1',
        exam: { chiefComplaint: 'Đau đầu nhẹ' },
      });

      expect(mockTx.clinicalEmr.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            encounterId: 'enc-1',
            patientId: 'pat-1',
            chiefComplaint: 'Đau đầu nhẹ',
            isFinalized: false,
          }),
        }),
      );
      expect(result.isFinalized).toBe(false);
    });

    it('cập nhật lại ClinicalEmr nếu đã có bản nháp chưa chốt', async () => {
      const { mockTx, mockPrisma } = buildDraftPrisma([
        { id: 'emr-draft-1', patientId: 'pat-1', isFinalized: false },
      ]);
      const service = new PrescriptionsService(mockPrisma) as any;

      await service.saveVisitDraft(doctorActor, 'enc-1', {
        patientId: 'pat-1',
        exam: { icd10Code: 'J00', icd10Diagnosis: 'Viêm mũi họng cấp' },
      });

      expect(mockTx.clinicalEmr.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'emr-draft-1' },
          data: expect.objectContaining({
            icd10Code: 'J00',
            icd10Diagnosis: 'Viêm mũi họng cấp',
          }),
        }),
      );
    });

    it('ném ConflictException nếu thành viên đã chốt hồ sơ (isFinalized === true)', async () => {
      const { mockPrisma } = buildDraftPrisma([
        { id: 'emr-final-1', patientId: 'pat-1', isFinalized: true },
      ]);
      const service = new PrescriptionsService(mockPrisma) as any;

      await expect(
        service.saveVisitDraft(doctorActor, 'enc-1', {
          patientId: 'pat-1',
          exam: { chiefComplaint: 'Sửa lại' },
        }),
      ).rejects.toThrow('Trang khám đã được xác nhận.');
    });
  });
});
