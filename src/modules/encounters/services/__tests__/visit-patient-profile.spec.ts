import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { EncounterRecordErrorCode } from '../../../../core/constants/error-codes.constant';
import { BaseApiException } from '../../../../core/exceptions/api.exception';
import type { PrismaService } from '../../../../core/database/prisma.service';
import { UpdateVisitPatientProfileDto } from '../../dtos/update-visit-patient-profile.dto';
import { PrescriptionsService } from '../prescriptions.service';

const actor = { id: 'doctor-1', role: 'DOCTOR', familyUnitId: null } as const;

function setup() {
  const visit = {
    id: 'visit-1',
    encounterStatus: 'IN_PROGRESS',
    scheduledDate: new Date('2026-11-27'),
    scheduledTime: new Date('1970-01-01T08:00:00Z'),
    doctor: {
      doctorName: 'BS Test',
      user: { phone: '0900000001' },
      facility: { facilityName: 'CSYT', address: null },
    },
    contract: {
      familyId: 'family-1',
      familyUnit: {
        representativeUser: {
          id: 'rep-1',
          role: 'FAMILY_REP',
          status: 'ACTIVE',
        },
      },
    },
    clinicalEmrs: [],
  };

  const tx = {
    encounter: {
      findFirst: jest.fn().mockResolvedValue(visit),
    },
    patient: {
      findFirst: jest.fn().mockResolvedValue({ id: 'patient-1' }),
      update: jest.fn().mockResolvedValue({
        id: 'patient-1',
        dateOfBirth: new Date('2022-05-01'),
        gender: null,
      }),
    },
  };

  const prisma = {
    $transaction: jest.fn((cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
  } as unknown as PrismaService;

  return { service: new PrescriptionsService(prisma), tx };
}

describe('PrescriptionsService.updateVisitPatientProfile & DTO', () => {
  it('updates only provided fields for visit member and returns profileCompleteness', async () => {
    const { service, tx } = setup();
    const result = await service.updateVisitPatientProfile(actor, 'visit-1', {
      patientId: '10000000-0000-4000-8000-000000000001',
      dateOfBirth: '2022-05-01',
    });

    expect(tx.patient.update).toHaveBeenCalledWith({
      where: { id: '10000000-0000-4000-8000-000000000001' },
      data: { dateOfBirth: new Date('2022-05-01') },
      select: { id: true, dateOfBirth: true, gender: true },
    });
    expect(result.profileCompleteness).toEqual({
      isComplete: false,
      missing: ['gender'],
    });
  });

  it('rejects with BaseApiException VISIT_NOT_FOUND when encounter is not found', async () => {
    const { service, tx } = setup();
    tx.encounter.findFirst.mockResolvedValue(null);

    const err = await service
      .updateVisitPatientProfile(actor, 'visit-1', {
        patientId: '10000000-0000-4000-8000-000000000001',
        dateOfBirth: '2022-05-01',
      })
      .catch((e) => e);

    expect(err).toBeInstanceOf(BaseApiException);
    expect(err).toMatchObject({
      errorCode: EncounterRecordErrorCode.VISIT_NOT_FOUND,
      status: 404,
    });
  });

  it('rejects future dateOfBirth with BaseApiException VALIDATION_FAILED', async () => {
    const { service } = setup();

    const err = await service
      .updateVisitPatientProfile(actor, 'visit-1', {
        patientId: '10000000-0000-4000-8000-000000000001',
        dateOfBirth: '2099-01-01',
      })
      .catch((e) => e);

    expect(err).toBeInstanceOf(BaseApiException);
    expect(err).toMatchObject({
      errorCode: 'VALIDATION_FAILED',
      invalidParams: [expect.objectContaining({ field: 'dateOfBirth' })],
    });
  });

  it('rejects invalid gender in DTO with Vietnamese message', async () => {
    const dto = plainToInstance(UpdateVisitPatientProfileDto, {
      patientId: '10000000-0000-4000-8000-000000000001',
      gender: 'X',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    expect(Object.values(errors[0].constraints ?? {})).toContain(
      'Giới tính không hợp lệ.',
    );
  });
});
