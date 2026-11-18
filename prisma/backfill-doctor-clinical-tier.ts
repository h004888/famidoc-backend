import { PrismaClient } from '@prisma/client';
import { inferDoctorClinicalTier } from '../src/modules/doctors/utils/doctor-clinical-tier.util';

export async function backfillDoctorClinicalTiers(
  prisma: PrismaClient,
): Promise<{ total: number; updated: number }> {
  const doctors = await prisma.doctor.findMany({
    select: {
      id: true,
      experienceYears: true,
      academicTitle: true,
      clinicalTier: true,
    },
  });

  let updated = 0;
  for (const doc of doctors) {
    const inferred = inferDoctorClinicalTier(
      doc.experienceYears,
      doc.academicTitle,
    );
    if (doc.clinicalTier !== inferred) {
      await prisma.doctor.update({
        where: { id: doc.id },
        data: { clinicalTier: inferred },
      });
      updated += 1;
    }
  }

  return { total: doctors.length, updated };
}

if (require.main === module) {
  const prisma = new PrismaClient();
  backfillDoctorClinicalTiers(prisma)
    .then((result) => {
      console.log(
        `Backfill clinical_tier hoàn tất: đã kiểm tra ${result.total} bác sĩ, cập nhật ${result.updated} bản ghi.`,
      );
    })
    .catch((err) => {
      console.error('Backfill clinical_tier thất bại:', err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
