import { ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
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
    chronicDiseases: 'Viêm mũi dị ứng',
  };

  it('chấp nhận payload chuẩn gửi relationshipToRepresentative cùng metadata y tế mới', async () => {
    const result = await pipe.transform(
      { ...basePayload, relationshipToRepresentative: 'CHILD' },
      { type: 'body', metatype: CreatePatientDto },
    );
    expect(result.relationshipToRepresentative).toBe('CHILD');
    expect(result.bloodType).toBe('O+');
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

  it('từ chối field lạ không nằm trong whitelist (ví dụ citizenId, healthInsuranceNumber, registeredHospital, identityCardNumber, phoneNumber)', async () => {
    await expect(
      pipe.transform(
        { ...basePayload, relationshipToRepresentative: 'CHILD', identityCardNumber: '123456' },
        { type: 'body', metatype: CreatePatientDto },
      ),
    ).rejects.toThrow();

    await expect(
      pipe.transform(
        { ...basePayload, relationshipToRepresentative: 'CHILD', citizenId: '001201500001' },
        { type: 'body', metatype: CreatePatientDto },
      ),
    ).rejects.toThrow();

    await expect(
      pipe.transform(
        { ...basePayload, relationshipToRepresentative: 'CHILD', healthInsuranceNumber: 'GD4790123899999' },
        { type: 'body', metatype: CreatePatientDto },
      ),
    ).rejects.toThrow();

    await expect(
      pipe.transform(
        { ...basePayload, relationshipToRepresentative: 'CHILD', registeredHospital: 'BV Test' },
        { type: 'body', metatype: CreatePatientDto },
      ),
    ).rejects.toThrow();

    await expect(
      pipe.transform(
        { ...basePayload, relationshipToRepresentative: 'CHILD', phoneNumber: '0987654321' },
        { type: 'body', metatype: CreatePatientDto },
      ),
    ).rejects.toThrow();
  });

  it('chấp nhận heightCm, weightKg và chronicConditions có cấu trúc hợp lệ', async () => {
    const result = await pipe.transform(
      {
        ...basePayload,
        relationshipToRepresentative: 'CHILD',
        heightCm: 168.5,
        weightKg: 62,
        chronicConditions: [
          {
            conditionName: 'Tăng huyết áp',
            icd10Code: 'I10',
            clinicalStatus: 'CONTROLLED',
            notes: 'Đang theo dõi định kỳ',
          },
        ],
      },
      { type: 'body', metatype: CreatePatientDto },
    );
    expect(result.heightCm).toBe(168.5);
    expect(result.weightKg).toBe(62);
    expect(result.chronicConditions).toHaveLength(1);
    expect(result.chronicConditions?.[0].conditionName).toBe('Tăng huyết áp');
  });

  it('từ chối heightCm hoặc weightKg ngoài ngưỡng hợp lệ', async () => {
    await expect(
      pipe.transform(
        { ...basePayload, relationshipToRepresentative: 'CHILD', heightCm: 10 },
        { type: 'body', metatype: CreatePatientDto },
      ),
    ).rejects.toThrow();

    await expect(
      pipe.transform(
        { ...basePayload, relationshipToRepresentative: 'CHILD', weightKg: 400 },
        { type: 'body', metatype: CreatePatientDto },
      ),
    ).rejects.toThrow();
  });

  it('cho phép thiếu dateOfBirth và gender khi tạo thành viên', async () => {
    const dto = plainToInstance(CreatePatientDto, {
      fullName: 'Nguyễn Văn A',
      relationshipToHead: 'CHILD',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('từ chối dateOfBirth ở tương lai với thông báo tiếng Việt', async () => {
    const dto = plainToInstance(CreatePatientDto, {
      fullName: 'Nguyễn Văn A',
      relationshipToHead: 'CHILD',
      dateOfBirth: '2099-01-01',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    expect(Object.values(errors[0].constraints ?? {})).toContain(
      'Ngày sinh không được ở tương lai.',
    );
  });

  it('từ chối dateOfBirth sai định dạng với thông báo tiếng Việt', async () => {
    const dto = plainToInstance(CreatePatientDto, {
      fullName: 'Nguyễn Văn A',
      relationshipToHead: 'CHILD',
      dateOfBirth: 'abc',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    expect(Object.values(errors[0].constraints ?? {})).toContain(
      'Ngày sinh không đúng định dạng YYYY-MM-DD.',
    );
  });
});
