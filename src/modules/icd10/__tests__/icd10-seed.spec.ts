import { importIcd10Csv } from '../icd10-seed';

const CSV = [
  'code,name_vi,name_en,chapter,dagger_asterisk',
  'I10,Tăng huyết áp vô căn,Essential hypertension,IX,',
  'B96.2,Escherichia coli là nguyên nhân gây bệnh,E. coli as the cause of diseases,I,',
].join('\n');

function makePrisma() {
  const upsert = jest.fn().mockResolvedValue({});
  const prisma: any = {
    icd10Code: { upsert },
    $transaction: jest.fn(async (ops: unknown[]) => Promise.all(ops)),
  };
  return { prisma, upsert };
}

describe('importIcd10Csv', () => {
  it('upsert từng mã: tạo mới nếu chưa có, cập nhật tên và cờ nếu đã có', async () => {
    const { prisma, upsert } = makePrisma();

    const result = await importIcd10Csv(prisma, CSV);

    expect(result).toEqual({ imported: 2, errors: 0 });
    expect(upsert).toHaveBeenCalledTimes(2);
    const i10 = upsert.mock.calls.find((c) => c[0].where.code === 'I10')![0];
    expect(i10.create).toMatchObject({
      code: 'I10',
      nameVi: 'Tăng huyết áp vô căn',
      longTermEligible: true,
      allowedAsPrimary: true,
    });
    expect(i10.update).toMatchObject({
      nameVi: 'Tăng huyết áp vô căn',
      longTermEligible: true,
      allowedAsPrimary: true,
      isActive: true,
    });
    expect(i10.update.code).toBeUndefined();

    const b96 = upsert.mock.calls.find((c) => c[0].where.code === 'B96.2')![0];
    expect(b96.update.allowedAsPrimary).toBe(false);
  });

  it('chia lô theo batchSize và đếm dòng lỗi', async () => {
    const { prisma, upsert } = makePrisma();
    const csv = `${CSV}\nSAI,Mã sai,,I,`;

    const result = await importIcd10Csv(prisma, csv, 1);

    expect(result).toEqual({ imported: 2, errors: 1 });
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(upsert).toHaveBeenCalledTimes(2);
  });
});
