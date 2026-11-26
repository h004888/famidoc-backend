import { Prisma } from '@prisma/client';
import { PrismaService } from '../src/core/database/prisma.service';
import { demoIds, seedDemo } from '../prisma/seed';

(process.env.RUN_DB_TESTS === '1' ? describe : describe.skip)(
  'Home Visit Exam Integrity DB Integration',
  () => {
    let prisma: PrismaService;
    const password = 'TestingOnly_Password_2026';
    const createdEmrIds: string[] = [];
    const createdVitalIds: string[] = [];
    let testPatientId: string;
    let testEncounterId: string;
    let testParticipantId: string;

    beforeAll(async () => {
      const target = new URL(process.env.DATABASE_URL!);
      if (
        !['localhost', '127.0.0.1'].includes(target.hostname) ||
        !target.pathname.endsWith('_test')
      ) {
        throw new Error('DB tests require a dedicated local *_test database');
      }

      prisma = new PrismaService();
      await prisma.$connect();
      await seedDemo(prisma, password);

      const patient = await prisma.patient.findFirstOrThrow({
        where: { familyId: demoIds.otherFamily },
      });
      testPatientId = patient.id;

      const encounter = await prisma.encounter.upsert({
        where: { id: demoIds.encounter },
        update: {},
        create: {
          id: demoIds.encounter,
          contractId: demoIds.activeContract,
          doctorId: demoIds.doctor,
          encounterType: 'HOME_VISIT',
          category: 'PERIODIC_ROUTINE',
          encounterStatus: 'IN_PROGRESS',
          scheduledDate: new Date('2026-11-26T00:00:00.000Z'),
          scheduledTime: new Date('1970-01-01T09:00:00.000Z'),
        },
      });
      testEncounterId = encounter.id;

      const participant = await prisma.encounterParticipant.upsert({
        where: {
          encounterId_patientId: {
            encounterId: testEncounterId,
            patientId: testPatientId,
          },
        },
        update: { absenceReason: null },
        create: {
          encounterId: testEncounterId,
          patientId: testPatientId,
          attendanceStatus: 'PLANNED',
        },
      });
      testParticipantId = participant.id;
    });

    afterAll(async () => {
      if (createdVitalIds.length > 0) {
        await prisma.vitalSign.deleteMany({
          where: { id: { in: createdVitalIds } },
        });
      }
      if (createdEmrIds.length > 0) {
        await prisma.clinicalEmr.deleteMany({
          where: { id: { in: createdEmrIds } },
        });
      }
      if (testParticipantId) {
        await prisma.encounterParticipant.updateMany({
          where: { id: testParticipantId },
          data: { absenceReason: null },
        });
      }
      await prisma.$disconnect();
    });

    it('(a) lưu và đọc lại weightKg trên vitalSign gắn clinicalEmr', async () => {
      const emr = await prisma.clinicalEmr.upsert({
        where: {
          encounterId_patientId: {
            encounterId: testEncounterId,
            patientId: testPatientId,
          },
        },
        update: {},
        create: {
          encounterId: testEncounterId,
          patientId: testPatientId,
          chiefComplaint: 'Kiểm tra sinh hiệu DB',
          clinicalFindings: 'Bình thường',
          icd10Code: 'Z00',
          icd10Diagnosis: 'Khám tổng quát',
          treatmentPlan: 'Theo dõi',
        },
      });
      createdEmrIds.push(emr.id);

      const vital = await prisma.vitalSign.create({
        data: {
          emrId: emr.id,
          patientId: testPatientId,
          systolicBp: 120,
          weightKg: 62.5,
        },
      });
      createdVitalIds.push(vital.id);

      const found = await prisma.vitalSign.findUniqueOrThrow({
        where: { id: vital.id },
      });
      expect(Number(found.weightKg)).toBe(62.5);
    });

    it('(b) tạo vitalSign thứ 2 cùng emrId bị reject P2002', async () => {
      const emrId = createdEmrIds[0];

      await expect(
        prisma.vitalSign.create({
          data: {
            emrId,
            patientId: testPatientId,
            systolicBp: 125,
          },
        }),
      ).rejects.toMatchObject({
        code: 'P2002',
      } as Partial<Prisma.PrismaClientKnownRequestError>);
    });

    it('(c) tạo 2 vitalSign với emrId: null cho cùng patient đều thành công', async () => {
      const v1 = await prisma.vitalSign.create({
        data: {
          emrId: null,
          patientId: testPatientId,
          systolicBp: 115,
        },
      });
      const v2 = await prisma.vitalSign.create({
        data: {
          emrId: null,
          patientId: testPatientId,
          systolicBp: 118,
        },
      });
      createdVitalIds.push(v1.id, v2.id);

      expect(v1.id).toBeDefined();
      expect(v2.id).toBeDefined();
      expect(v1.id).not.toBe(v2.id);
    });

    it('(d) cập nhật encounterParticipant.absenceReason và đọc lại đúng', async () => {
      await prisma.encounterParticipant.update({
        where: { id: testParticipantId },
        data: { absenceReason: 'Đi công tác' },
      });

      const updated = await prisma.encounterParticipant.findUniqueOrThrow({
        where: { id: testParticipantId },
      });
      expect(updated.absenceReason).toBe('Đi công tác');
    });
  },
);
