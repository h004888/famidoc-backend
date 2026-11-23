import { ValidationPipe } from '@nestjs/common';
import {
  ConfirmVisitRecordDto,
  FamilyPrescriptionsDto,
  SharePrescriptionDto,
} from '../../dtos/share-prescription.dto';

const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
});
const id = '10000000-0000-4000-8000-000000000001';
const drug = {
  medicationName: 'Tên thuốc',
  activeIngredient: 'Hoạt chất',
  strength: '500mg',
  dosage: '1 viên',
  administrationRoute: 'Uống',
  frequency: 'Sau ăn',
  quantity: 6,
  unit: 'Viên',
  durationDays: 3,
};
const prescription = {
  details: [drug],
  recipientUserId: id,
  recipientAuthorized: true,
};

describe('Vietnamese nested prescription validation', () => {
  it.each([
    [
      SharePrescriptionDto,
      { ...prescription, details: [null] },
      'Từng dòng thuốc',
    ],
    [
      SharePrescriptionDto,
      { ...prescription, details: [42] },
      'Từng dòng thuốc',
    ],
    [
      SharePrescriptionDto,
      { ...prescription, clinicalContext: 42 },
      'Thông tin ngữ cảnh',
    ],
    [
      SharePrescriptionDto,
      { ...prescription, exam: 'wrong' },
      'Thông tin khám',
    ],
    [
      ConfirmVisitRecordDto,
      { patientId: id, confirmed: true, exam: 42 },
      'Thông tin khám',
    ],
    [
      ConfirmVisitRecordDto,
      { patientId: id, confirmed: true, prescription: 42 },
      'Thông tin đơn thuốc',
    ],
    [
      FamilyPrescriptionsDto,
      { prescriptions: [null] },
      'Từng đơn thuốc gia đình',
    ],
  ])(
    'returns Vietnamese messages for invalid nested data %#',
    async (metatype, body, expected) => {
      try {
        await pipe.transform(body, { type: 'body', metatype });
        throw new Error('Expected validation rejection');
      } catch (error) {
        const response = (
          error as { getResponse(): { message: string[] } }
        ).getResponse();
        expect(response.message.join('; ')).toContain(expected);
        expect(response.message.join('; ')).not.toMatch(
          /must be|nested property|each value|should not/i,
        );
      }
    },
  );
});
