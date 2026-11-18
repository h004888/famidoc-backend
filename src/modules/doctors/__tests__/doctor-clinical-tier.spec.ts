import { DoctorClinicalTier } from '@prisma/client';
import { inferDoctorClinicalTier } from '../utils/doctor-clinical-tier.util';
import { backfillDoctorClinicalTiers } from '../../../../prisma/backfill-doctor-clinical-tier';

describe('inferDoctorClinicalTier & backfillDoctorClinicalTiers', () => {
  it('classifies senior doctors by experience years or senior academic title', () => {
    expect(inferDoctorClinicalTier(12, 'BS')).toBe(DoctorClinicalTier.SENIOR);
    expect(inferDoctorClinicalTier(6, 'TS. BS')).toBe(DoctorClinicalTier.SENIOR);
    expect(inferDoctorClinicalTier(4, 'PGS.TS')).toBe(DoctorClinicalTier.SENIOR);
    expect(inferDoctorClinicalTier(8, 'BS.CKII')).toBe(DoctorClinicalTier.SENIOR);
  });

  it('classifies junior doctors with < 5 years and no intermediate/senior title', () => {
    expect(inferDoctorClinicalTier(2, 'BS')).toBe(DoctorClinicalTier.JUNIOR);
    expect(inferDoctorClinicalTier(4, null)).toBe(DoctorClinicalTier.JUNIOR);
  });

  it('classifies standard doctors in between', () => {
    expect(inferDoctorClinicalTier(5, 'BS')).toBe(DoctorClinicalTier.STANDARD);
    expect(inferDoctorClinicalTier(3, 'ThS.BS')).toBe(
      DoctorClinicalTier.STANDARD,
    );
    expect(inferDoctorClinicalTier(4, 'BS.CKI')).toBe(
      DoctorClinicalTier.STANDARD,
    );
  });

  it('backfills only doctors whose clinicalTier differs from inferred value', async () => {
    const prismaMock = {
      doctor: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'd1',
            experienceYears: 2,
            academicTitle: 'BS',
            clinicalTier: DoctorClinicalTier.STANDARD,
          },
          {
            id: 'd2',
            experienceYears: 15,
            academicTitle: 'CKII',
            clinicalTier: DoctorClinicalTier.SENIOR,
          },
        ]),
        update: jest.fn().mockResolvedValue({}),
      },
    } as any;

    const result = await backfillDoctorClinicalTiers(prismaMock);
    expect(result).toEqual({ total: 2, updated: 1 });
    expect(prismaMock.doctor.update).toHaveBeenCalledTimes(1);
    expect(prismaMock.doctor.update).toHaveBeenCalledWith({
      where: { id: 'd1' },
      data: { clinicalTier: DoctorClinicalTier.JUNIOR },
    });
  });
});
