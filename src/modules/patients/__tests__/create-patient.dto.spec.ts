import { ValidationPipe } from '@nestjs/common';
import { CreatePatientDto } from '../dtos/create-patient.dto';
import { Gender } from '@prisma/client';

describe('CreatePatientDto Validation', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
  });

  const basePayload = {
    fullName: 'Nguyễn Kiểm Thử Con',
    dateOfBirth: '2015-05-20',
    gender: Gender.FEMALE,
    bloodType: 'O+',
    registeredHospital: 'BV Đại học Y Dược TP.HCM',
    chronicDiseases: 'Viêm mũi dị ứng',
    healthInsuranceNumber: 'GD4790123899999',
  };

  it('chấp nhận payload chuẩn gửi relationshipToRepresentative cùng metadata y tế mới', async () => {
    const result = await pipe.transform(
      { ...basePayload, relationshipToRepresentative: 'CHILD' },
      { type: 'body', metatype: CreatePatientDto },
    );
    expect(result.relationshipToRepresentative).toBe('CHILD');
    expect(result.bloodType).toBe('O+');
    expect(result.registeredHospital).toBe('BV Đại học Y Dược TP.HCM');
    expect(result.chronicDiseases).toBe('Viêm mũi dị ứng');
  });

  it('chấp nhận client tương thích ngược chỉ gửi relationshipToHead', async () => {
    const result = await pipe.transform(
      { ...basePayload, relationshipToHead: 'CHILD' },
      { type: 'body', metatype: CreatePatientDto },
    );
    expect(result.relationshipToHead).toBe('CHILD');
  });

  it('từ chối khi thiếu cả relationshipToRepresentative lẫn relationshipToHead', async () => {
    await expect(
      pipe.transform(basePayload, { type: 'body', metatype: CreatePatientDto }),
    ).rejects.toThrow();
  });

  it('từ chối field lạ không nằm trong whitelist (ví dụ identityCardNumber)', async () => {
    await expect(
      pipe.transform(
        { ...basePayload, relationshipToRepresentative: 'CHILD', identityCardNumber: '123456' },
        { type: 'body', metatype: CreatePatientDto },
      ),
    ).rejects.toThrow();
  });
});
