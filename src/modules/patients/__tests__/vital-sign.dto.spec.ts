import { ValidationPipe } from '@nestjs/common';
import { CreateVitalSignDto } from '../dtos/create-vital-sign.dto';
import { UpdateVitalSignDto } from '../dtos/update-vital-sign.dto';
import { computeVitalAbnormalAlert } from '../utils/vital-sign.util';

describe('VitalSign DTO Validation & Alert Thresholds', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
  });

  it('chấp nhận payload đầy đủ và payload chỉ có một chỉ số (ví dụ SpO2)', async () => {
    const full = await pipe.transform(
      {
        systolicBp: 122,
        diastolicBp: 78,
        heartRate: 72,
        temperature: 36.6,
        spo2: 98,
        respiratoryRate: 16,
        bloodGlucose: 5.4,
        recordedAt: '2026-11-18T07:30:00.000Z',
      },
      { type: 'body', metatype: CreateVitalSignDto },
    );
    expect(full.systolicBp).toBe(122);
    expect(full.temperature).toBe(36.6);

    const partial = await pipe.transform(
      { spo2: 97 },
      { type: 'body', metatype: CreateVitalSignDto },
    );
    expect(partial.spo2).toBe(97);
    expect(partial.systolicBp).toBeUndefined();
  });

  it('từ chối payload rỗng không có chỉ số sinh tồn nào khi tạo mới', async () => {
    await expect(
      pipe.transform({}, { type: 'body', metatype: CreateVitalSignDto }),
    ).rejects.toThrow();

    await expect(
      pipe.transform(
        { recordedAt: '2026-11-18T07:30:00.000Z' },
        { type: 'body', metatype: CreateVitalSignDto },
      ),
    ).rejects.toThrow();
  });

  it('từ chối các chỉ số vượt ngưỡng sinh lý hoặc field lạ', async () => {
    await expect(
      pipe.transform(
        { systolicBp: 25 },
        { type: 'body', metatype: CreateVitalSignDto },
      ),
    ).rejects.toThrow();

    await expect(
      pipe.transform(
        { spo2: 105 },
        { type: 'body', metatype: CreateVitalSignDto },
      ),
    ).rejects.toThrow();

    await expect(
      pipe.transform(
        { bloodGlucose: 55 },
        { type: 'body', metatype: CreateVitalSignDto },
      ),
    ).rejects.toThrow();

    await expect(
      pipe.transform(
        { spo2: 98, isAbnormalAlert: false },
        { type: 'body', metatype: CreateVitalSignDto },
      ),
    ).rejects.toThrow();
  });

  it('cho phép UpdateVitalSignDto cập nhật từng phần hợp lệ', async () => {
    const updated = await pipe.transform(
      { heartRate: 84, recordedAt: '2026-11-18T09:00:00.000Z' },
      { type: 'body', metatype: UpdateVitalSignDto },
    );
    expect(updated.heartRate).toBe(84);
  });

  it('tính chính xác cờ cảnh báo isAbnormalAlert theo ngưỡng lâm sàng', () => {
    expect(
      computeVitalAbnormalAlert({
        systolicBp: 120,
        diastolicBp: 78,
        heartRate: 72,
        temperature: 36.6,
        spo2: 98,
        respiratoryRate: 16,
        bloodGlucose: 5.5,
      }),
    ).toBe(false);

    expect(computeVitalAbnormalAlert({ systolicBp: 145 })).toBe(true);
    expect(computeVitalAbnormalAlert({ diastolicBp: 92 })).toBe(true);
    expect(computeVitalAbnormalAlert({ spo2: 93 })).toBe(true);
    expect(computeVitalAbnormalAlert({ temperature: 38.4 })).toBe(true);
    expect(computeVitalAbnormalAlert({ bloodGlucose: 12.0 })).toBe(true);
    expect(computeVitalAbnormalAlert({ heartRate: 45 })).toBe(true);
  });
});
