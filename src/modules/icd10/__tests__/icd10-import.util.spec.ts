import { parseIcd10Csv, toIcd10Record } from '../icd10-import.util';

describe('icd10-import.util', () => {
  describe('parseIcd10Csv', () => {
    it('phân tích đúng CSV mẫu 5 dòng, chuẩn hóa mã và đưa dòng mã lỗi vào errors', () => {
      const csv = [
        'I10,Tăng huyết áp vô căn (nguyên phát),Essential hypertension,IX,NONE',
        'J06.9,Nhiễm trùng hô hấp trên cấp,Acute upper respiratory infection,X,NONE',
        'B96.2,Escherichia coli là nguyên nhân gây bệnh,Escherichia coli as cause of diseases,I,NONE',
        'G63.2,Bệnh đa dây thần kinh do đái tháo đường,Diabetic polyneuropathy,VI,ASTERISK',
        'e11.9 ,Đái tháo đường không phụ thuộc insulin,Type 2 diabetes mellitus,IV,NONE',
        'XYZ,Mã không hợp lệ,Invalid code,I,NONE',
      ].join('\n');

      const result = parseIcd10Csv(csv);

      expect(result.rows).toHaveLength(5);
      expect(result.rows.map((r) => r.code)).toEqual([
        'I10',
        'J06.9',
        'B96.2',
        'G63.2',
        'E11.9',
      ]);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].raw).toContain('XYZ');
    });

    it('tách đúng dòng có tên chứa dấu phẩy trong ngoặc kép', () => {
      const csv =
        'J18.9,"Viêm phổi, không đặc hiệu","Pneumonia, unspecified",X,NONE';

      const result = parseIcd10Csv(csv);

      expect(result.errors).toHaveLength(0);
      expect(result.rows).toEqual([
        {
          code: 'J18.9',
          nameVi: 'Viêm phổi, không đặc hiệu',
          nameEn: 'Pneumonia, unspecified',
          chapter: 'X',
          daggerAsterisk: 'NONE',
        },
      ]);
    });
  });

  describe('toIcd10Record', () => {
    it('tính đúng allowedAsPrimary và longTermEligible cho từng loại mã ICD-10', () => {
      const csv = [
        'I10,Tăng huyết áp vô căn (nguyên phát),Essential hypertension,IX,NONE',
        'J06.9,Nhiễm trùng hô hấp trên cấp,Acute upper respiratory infection,X,NONE',
        'B96.2,Escherichia coli là nguyên nhân gây bệnh,Escherichia coli as cause of diseases,I,NONE',
        'G63.2,Bệnh đa dây thần kinh do đái tháo đường,Diabetic polyneuropathy,VI,ASTERISK',
        'e11.9 ,Đái tháo đường không phụ thuộc insulin,Type 2 diabetes mellitus,IV,NONE',
      ].join('\n');

      const { rows } = parseIcd10Csv(csv);
      const records = rows.map(toIcd10Record);
      const byCode = new Map(records.map((r) => [r.code, r]));

      expect(byCode.get('I10')).toMatchObject({
        code: 'I10',
        allowedAsPrimary: true,
        longTermEligible: true,
        isActive: true,
      });

      expect(byCode.get('J06.9')).toMatchObject({
        code: 'J06.9',
        allowedAsPrimary: true,
        longTermEligible: false,
      });

      expect(byCode.get('B96.2')).toMatchObject({
        code: 'B96.2',
        allowedAsPrimary: false,
      });

      expect(byCode.get('G63.2')).toMatchObject({
        code: 'G63.2',
        allowedAsPrimary: false,
      });

      expect(byCode.get('E11.9')).toMatchObject({
        code: 'E11.9',
        allowedAsPrimary: true,
        longTermEligible: true,
      });
    });

    it('chặn allowedAsPrimary cho toàn bộ nhóm B95–B97 và cho phép DAGGER', () => {
      const b95 = toIcd10Record({
        code: 'B95.0',
        nameVi: 'Liên cầu khuẩn nhóm A',
        nameEn: null,
        chapter: 'I',
        daggerAsterisk: 'NONE',
      });
      const b97 = toIcd10Record({
        code: 'B97',
        nameVi: 'Virus là nguyên nhân gây bệnh',
        nameEn: null,
        chapter: 'I',
        daggerAsterisk: 'NONE',
      });
      const dagger = toIcd10Record({
        code: 'E11.4',
        nameVi: 'Đái tháo đường có biến chứng thần kinh',
        nameEn: null,
        chapter: 'IV',
        daggerAsterisk: 'DAGGER',
      });

      expect(b95.allowedAsPrimary).toBe(false);
      expect(b97.allowedAsPrimary).toBe(false);
      expect(dagger.allowedAsPrimary).toBe(true);
      expect(dagger.longTermEligible).toBe(true);
    });
  });
});
