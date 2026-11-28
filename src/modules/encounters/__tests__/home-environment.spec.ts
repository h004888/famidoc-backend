import { HttpStatus, NotFoundException, ValidationPipe } from '@nestjs/common';
import { BaseApiException } from '../../../core/exceptions/api.exception';
import { SaveHomeEnvironmentDto } from '../dtos/home-environment.dto';
import { MedicalBooksService } from '../services/medical-books.service';

const doctorActor = {
  id: 'doc-user-1',
  role: 'DOCTOR',
  familyUnitId: null,
} as any;

const patientId1 = '10000000-0000-4000-8000-000000000001';
const patientId2 = '10000000-0000-4000-8000-000000000002';

function makeHarness(overrides?: {
  visit?: any;
  previousEnv?: any;
  patients?: Array<{ id: string }>;
  existingParticipants?: Array<{ patientId: string; attendanceStatus: string }>;
}) {
  const defaultVisit = {
    id: 'enc-1',
    contractId: 'contract-1',
    encounterStatus: 'IN_PROGRESS',
    scheduledDate: new Date('2026-11-27T00:00:00.000Z'),
    scheduledTime: new Date('1970-01-01T08:30:00.000Z'),
    contract: { familyId: 'fam-1' },
  };

  const tx: any = {
    encounter: {
      findFirst: jest.fn().mockResolvedValue(
        overrides && 'visit' in overrides ? overrides.visit : defaultVisit,
      ),
    },
    encounterHomeEnvironment: {
      findFirst: jest.fn().mockResolvedValue(overrides?.previousEnv ?? null),
      upsert: jest.fn().mockImplementation(async ({ create, update }) => ({
        id: 'env-1',
        ...create,
        ...update,
      })),
    },
    patient: {
      findMany: jest
        .fn()
        .mockResolvedValue(
          overrides?.patients ?? [{ id: patientId1 }, { id: patientId2 }],
        ),
    },
    encounterParticipant: {
      findMany: jest
        .fn()
        .mockResolvedValue(overrides?.existingParticipants ?? []),
      upsert: jest.fn().mockImplementation(async ({ create }) => ({
        id: 'part-1',
        ...create,
      })),
    },
  };

  const prisma: any = {
    $transaction: jest.fn((cb: (client: any) => Promise<any>) => cb(tx)),
    encounter: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'enc-1',
        homeEnvironment: {
          id: 'env-1',
          encounterId: 'enc-1',
          fallRisk: true,
          waterSource: 'Nước máy',
          pets: 'Mèo',
        },
        participants: [
          {
            patientId: patientId2,
            attendanceStatus: 'ABSENT',
            absenceReason: 'Đi học',
            patient: { id: patientId2, fullName: 'Bé An' },
          },
        ],
      }),
    },
  };

  const service = new MedicalBooksService(prisma, {} as any);
  return { service, prisma, tx };
}

describe('Task 7: MedicalBooksService homeEnvironment & saveHomeEnvironment', () => {
  it('(a) lưu fallRisk và participant ABSENT hợp lệ -> upsert môi trường và thành viên', async () => {
    const { service, tx } = makeHarness();

    const result = await (service as any).saveHomeEnvironment(
      doctorActor,
      'enc-1',
      {
        fallRisk: true,
        participants: [
          {
            patientId: patientId2,
            attendanceStatus: 'ABSENT',
            absenceReason: 'Đi học',
          },
        ],
      },
    );

    expect(tx.encounterHomeEnvironment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { encounterId: 'enc-1' },
        create: expect.objectContaining({
          encounterId: 'enc-1',
          fallRisk: true,
        }),
        update: expect.objectContaining({
          fallRisk: true,
        }),
      }),
    );
    expect(tx.encounterParticipant.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          encounterId_patientId: {
            encounterId: 'enc-1',
            patientId: patientId2,
          },
        },
        create: expect.objectContaining({
          encounterId: 'enc-1',
          patientId: patientId2,
          attendanceStatus: 'ABSENT',
          absenceReason: 'Đi học',
        }),
        update: expect.objectContaining({
          attendanceStatus: 'ABSENT',
          absenceReason: 'Đi học',
        }),
      }),
    );
    expect(result.homeEnvironment.fallRisk).toBe(true);
  });

  it('(b) ABSENT thiếu absenceReason -> 422 field participants[0].absenceReason', async () => {
    const { service } = makeHarness();

    await expect(
      (service as any).saveHomeEnvironment(doctorActor, 'enc-1', {
        participants: [
          {
            patientId: patientId2,
            attendanceStatus: 'ABSENT',
          },
        ],
      }),
    ).rejects.toMatchObject({
      status: HttpStatus.UNPROCESSABLE_ENTITY,
      invalidParams: [
        expect.objectContaining({
          field: 'participants[0].absenceReason',
          message: 'Vui lòng ghi lý do vắng mặt.',
        }),
      ],
    });
  });

  it('(c) copyFromPreviousVisit = true kế thừa buổi trước và ghi đè bằng DTO', async () => {
    const { service, tx } = makeHarness({
      previousEnv: {
        visitAddress: '12 Lê Lợi',
        primaryInformantName: 'Bà Lan',
        housingNotes: 'Nhà 2 tầng',
        fallRisk: false,
        waterSource: 'Nước máy',
        smokingInHouse: false,
        pets: 'Chó',
        notes: 'Ghi chú cũ',
      },
    });

    await (service as any).saveHomeEnvironment(doctorActor, 'enc-1', {
      copyFromPreviousVisit: true,
      pets: 'Mèo',
      participants: [],
    });

    expect(tx.encounterHomeEnvironment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          waterSource: 'Nước máy',
          pets: 'Mèo',
        }),
        update: expect.objectContaining({
          waterSource: 'Nước máy',
          pets: 'Mèo',
        }),
      }),
    );
  });

  it('(d) người đã EXAMINED chuyển về ABSENT -> 409 VISIT_RECORD_LOCKED', async () => {
    const { service } = makeHarness({
      existingParticipants: [
        { patientId: patientId2, attendanceStatus: 'EXAMINED' },
      ],
    });

    let caught: unknown;
    try {
      await (service as any).saveHomeEnvironment(doctorActor, 'enc-1', {
        participants: [
          {
            patientId: patientId2,
            attendanceStatus: 'ABSENT',
            absenceReason: 'Về quê đột xuất',
          },
        ],
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(BaseApiException);
    expect(caught).toMatchObject({
      status: HttpStatus.CONFLICT,
      errorCode: 'VISIT_RECORD_LOCKED',
    });
  });

  it('(e) homeEnvironment trả về dữ liệu môi trường + thành viên và ném NotFoundException nếu ngoài phạm vi', async () => {
    const { service, prisma } = makeHarness();

    const ok = await (service as any).homeEnvironment(doctorActor, 'enc-1');
    expect(ok.homeEnvironment).toMatchObject({
      waterSource: 'Nước máy',
      pets: 'Mèo',
    });
    expect(ok.participants).toHaveLength(1);

    prisma.encounter.findFirst.mockResolvedValueOnce(null);
    await expect(
      (service as any).homeEnvironment(doctorActor, 'enc-other'),
    ).rejects.toThrow(NotFoundException);
  });

  it('(f) SaveHomeEnvironmentDto validate tiếng Việt với ValidationPipe', async () => {
    const pipe = new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    const valid = await pipe.transform(
      {
        fallRisk: true,
        participants: [
          {
            patientId: patientId1,
            attendanceStatus: 'PRESENT',
          },
          {
            patientId: patientId2,
            attendanceStatus: 'PLANNED',
          },
        ],
      },
      { type: 'body', metatype: SaveHomeEnvironmentDto },
    );
    expect(valid.fallRisk).toBe(true);
    expect(valid.participants?.[0]?.attendanceStatus).toBe('PRESENT');

    await expect(
      pipe.transform(
        {
          participants: [
            {
              patientId: patientId1,
              attendanceStatus: 'EXAMINED',
            },
          ],
        },
        { type: 'body', metatype: SaveHomeEnvironmentDto },
      ),
    ).rejects.toBeDefined();

    await expect(
      pipe.transform(
        {
          participants: [
            {
              patientId: 'not-a-uuid',
              attendanceStatus: 'INVALID',
            },
          ],
        },
        { type: 'body', metatype: SaveHomeEnvironmentDto },
      ),
    ).rejects.toBeDefined();
  });

  it('(h) saveHomeEnvironment upsert PRESENT cho thành viên có mặt và KHÔNG ghi đè lùi thành viên đã EXAMINED', async () => {
    const { service, tx } = makeHarness({
      existingParticipants: [
        { patientId: patientId2, attendanceStatus: 'EXAMINED' },
      ],
    });

    await (service as any).saveHomeEnvironment(doctorActor, 'enc-1', {
      participants: [
        { patientId: patientId1, attendanceStatus: 'PRESENT' },
        { patientId: patientId2, attendanceStatus: 'PRESENT' },
      ],
    });

    expect(tx.encounterParticipant.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          encounterId_patientId: { encounterId: 'enc-1', patientId: patientId1 },
        },
        create: expect.objectContaining({
          attendanceStatus: 'PRESENT',
          absenceReason: null,
        }),
        update: expect.objectContaining({
          attendanceStatus: 'PRESENT',
          absenceReason: null,
        }),
      }),
    );

    const p2UpsertCalls = tx.encounterParticipant.upsert.mock.calls.filter(
      (c: any[]) => c[0]?.where?.encounterId_patientId?.patientId === patientId2,
    );
    expect(p2UpsertCalls).toHaveLength(0);
  });

  it('(g) saveHomeEnvironment trước giờ khám (CONFIRMED) ném BaseApiException VISIT_NOT_STARTED kèm conditions; homeEnvironment vẫn đọc được theo doctor scope', async () => {
    const { service, tx, prisma } = makeHarness({ visit: null });
    tx.encounter.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ encounterStatus: 'CONFIRMED' });

    await expect(
      (service as any).saveHomeEnvironment(doctorActor, 'enc-future', {
        participants: [],
      }),
    ).rejects.toMatchObject({
      status: HttpStatus.CONFLICT,
      errorCode: 'VISIT_NOT_STARTED',
      conditions: [expect.objectContaining({ code: 'VISIT_NOT_STARTED' })],
    });

    prisma.encounter.findFirst.mockResolvedValueOnce({
      id: 'enc-future',
      homeEnvironment: null,
      participants: [],
    });
    const readRes = await (service as any).homeEnvironment(doctorActor, 'enc-future');
    expect(readRes).toEqual({
      encounterId: 'enc-future',
      homeEnvironment: null,
      participants: [],
    });
    const readWhere = prisma.encounter.findFirst.mock.calls.at(-1)?.[0]?.where;
    expect(readWhere).toHaveProperty('id', 'enc-future');
    expect(readWhere).toHaveProperty('doctor');
    expect(readWhere).not.toHaveProperty('AND');
  });
});
