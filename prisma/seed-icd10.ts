import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { importIcd10Csv } from '../src/modules/icd10/icd10-seed';

const DEFAULT_CSV_PATH = join(__dirname, 'data', 'icd10-qd4469.csv');

export async function seedIcd10(
  prisma: PrismaClient,
  csvPath: string = DEFAULT_CSV_PATH,
): Promise<{ imported: number; errors: number }> {
  if (!existsSync(csvPath)) {
    throw new Error(
      `Không tìm thấy file danh mục ICD-10 tại ${csvPath}. ` +
        'Hãy chuẩn bị file CSV (code,name_vi,name_en,chapter,dagger_asterisk) từ Phụ lục 1 QĐ 4469/QĐ-BYT.',
    );
  }
  return importIcd10Csv(prisma, readFileSync(csvPath, 'utf8'));
}

if (require.main === module) {
  const prisma = new PrismaClient();
  seedIcd10(prisma, process.argv[2])
    .then(({ imported, errors }) => {
      console.log(
        `ICD-10 seed hoàn tất: đã nạp ${imported} dòng, lỗi ${errors} dòng.`,
      );
    })
    .catch((err) => {
      console.error('ICD-10 seed thất bại:', err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
