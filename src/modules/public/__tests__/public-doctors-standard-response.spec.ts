import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PublicController } from '../controllers/public.controller';
import {
  IPublicService,
  PUBLIC_SERVICE_TOKEN,
} from '../services/interfaces/public.service.interface';
import { TransformResponseInterceptor } from '../../../core/interceptors/transform-response.interceptor';
import { StandardApiResponseFilter } from '../../../core/filters/standard-api-response.filter';

describe('Public Doctors API — Standard Response & Error Formatting', () => {
  let app: INestApplication<App>;
  let mockPublicService: Partial<jest.Mocked<IPublicService>>;

  beforeAll(async () => {
    mockPublicService = {
      lookupDoctorDirectory: jest.fn().mockResolvedValue({
        items: [
          {
            id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
            doctorName: 'BS. CKI Nguyễn Văn A',
            specialty: 'Y học gia đình',
            academicTitle: 'ThS.BS',
            experienceYears: 10,
            bio: 'Chuyên gia Y học gia đình',
            ratingAvg: 4.95,
            totalReviews: 42,
            isAvailable: true,
            facility: {
              id: 'c71e982d-bf41-4796-b611-3d964cb7d8a1',
              facilityName: 'Phòng khám Đa khoa Quốc tế FamiDoc',
              address: 'Số 10 Phố Huế, Quận Hai Bà Trưng, Hà Nội',
              hotline: '1900 6868',
            },
          },
        ],
        meta: {
          total: 1,
          page: 1,
          limit: 10,
          totalPages: 1,
        },
      } as any),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [PublicController],
      providers: [
        {
          provide: PUBLIC_SERVICE_TOKEN,
          useValue: mockPublicService,
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    app.useGlobalInterceptors(new TransformResponseInterceptor());
    app.useGlobalFilters(new StandardApiResponseFilter());

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Success Response Format', () => {
    it('GET /api/v1/public/doctors: Trả về đúng chuẩn Unified Envelope với data là mảng và meta.pagination', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/public/doctors?page=1&limit=10')
        .set('X-Request-Id', 'req_test_doc_01')
        .expect(200);

      expect(res.headers['x-request-id']).toBe('req_test_doc_01');
      expect(res.body.success).toBe(true);
      expect(res.body.code).toBe(200);
      expect(res.body.message).toBe('Tra cứu danh bạ bác sĩ gia đình thành công');
      expect(res.body.requestId).toBe('req_test_doc_01');
      expect(res.body.timestamp).toBeDefined();

      // data phải là array danh sách bác sĩ
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0]).toMatchObject({
        id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
        doctorName: 'BS. CKI Nguyễn Văn A',
        specialty: 'Y học gia đình',
      });

      // meta phải chứa pagination chuẩn
      expect(res.body.meta).toBeDefined();
      expect(res.body.meta.pagination).toEqual({
        page: 1,
        pageSize: 10,
        totalRecords: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      });
    });
  });

  describe('Error Response Format', () => {
    it('Trả về HTTP 422 chuẩn RFC 9457 khi facilityId không đúng định dạng UUID', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/public/doctors?facilityId=invalid-uuid-123')
        .expect(422);

      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe(422);
      expect(res.body.data).toBeNull();
      expect(res.body.meta).toBeNull();
      expect(res.body.error).toBeDefined();
      expect(res.body.error.errorCode).toBe('VALIDATION_FAILED');
      expect(res.body.error.type).toBe('https://api.famidoc.vn/errors/validation-failed');
      expect(res.body.error.title).toBe('Unprocessable Content');
      expect(res.body.error.detail).toBe(
        'One or more fields in the request failed validation constraints.',
      );

      const invalidParam = res.body.error.invalidParams?.find(
        (p: any) => p.field === 'facilityId',
      );
      expect(invalidParam).toBeDefined();
      expect(invalidParam?.issue).toBe('INVALID_FORMAT');
    });

    it('Trả về HTTP 422 chuẩn RFC 9457 khi minExperienceYears là số âm', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/public/doctors?minExperienceYears=-5')
        .expect(422);

      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe(422);

      const invalidParam = res.body.error.invalidParams?.find(
        (p: any) => p.field === 'minExperienceYears',
      );
      expect(invalidParam).toBeDefined();
      expect(invalidParam?.issue).toBe('MIN_VALUE');
    });

    it('Trả về HTTP 422 khi truyền query parameter lạ ngoài whitelist', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/public/doctors?hackAttempt=1')
        .expect(422);

      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe(422);

      const invalidParam = res.body.error.invalidParams?.find(
        (p: any) => p.field === 'hackAttempt',
      );
      expect(invalidParam).toBeDefined();
    });
  });
});
