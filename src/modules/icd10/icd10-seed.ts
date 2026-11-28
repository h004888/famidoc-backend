import type { PrismaClient } from '@prisma/client';
import { parseIcd10Csv, toIcd10Record } from './icd10-import.util';

const DEFAULT_BATCH_SIZE = 500;

/**
 * Nạp danh mục ICD-10 (QĐ 4469/QĐ-BYT) từ CSV.
 * Dùng upsert để chạy lại được: mã chưa có thì tạo, mã đã có thì cập nhật
 * tên, chương, dấu †/*, cờ "được dùng làm mã chính" và "được kê tới 90 ngày".
 */
export async function importIcd10Csv(
  prisma: Pick<PrismaClient, 'icd10Code' | '$transaction'>,
  csvText: string,
  batchSize: number = DEFAULT_BATCH_SIZE,
): Promise<{ imported: number; errors: number }> {
  const { rows, errors } = parseIcd10Csv(csvText);
  const records = rows.map(toIcd10Record);

  let imported = 0;
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    await prisma.$transaction(
      batch.map(({ code, ...fields }) =>
        prisma.icd10Code.upsert({
          where: { code },
          create: { code, ...fields },
          update: fields,
        }),
      ),
    );
    imported += batch.length;
  }

  return { imported, errors: errors.length };
}
