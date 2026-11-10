import { Test, TestingModule } from '@nestjs/testing';
import {
  INestApplication,
  Controller,
  Get,
  Post,
  Body,
  ValidationPipe,
  Query,
} from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { IsEmail, IsNotEmpty, MinLength } from 'class-validator';
import { TransformResponseInterceptor } from '../src/core/interceptors/transform-response.interceptor';
import { StandardApiResponseFilter } from '../src/core/filters/standard-api-response.filter';
import { ResourceNotFoundException } from '../src/core/exceptions/api.exception';

class CreateTestUserDto {
  @IsNotEmpty({ message: 'fullName không được để trống' })
  fullName!: string;

  @IsEmail({}, { message: 'email phải là địa chỉ email hợp lệ' })
  email!: string;

  @MinLength(6, { message: 'password phải có ít nhất 6 ký tự' })
  password!: string;
}

@Controller('test-api')
class E2ETestController {
  @Get('single')
  getSingle() {
    return { id: 'usr_01', name: 'Nguyen Van A' };
  }

  @Get('paginated')
  getPaginated(@Query('page') page: string) {
    return {
      data: [{ id: '1' }, { id: '2' }],
      meta: {
        pagination: {
          page: Number(page) || 1,
          pageSize: 20,
          totalRecords: 2,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      },
      message: 'Lấy danh sách thành công',
    };
  }

  @Post('users')
  createUser(@Body() dto: CreateTestUserDto) {
    return { id: 'usr_created', ...dto };
  }

  @Get('not-found')
  getNotFound() {
    throw new ResourceNotFoundException('USER_NOT_FOUND', 'Người dùng không tồn tại');
  }
}

describe('Standard API Response Pipeline (E2E Integration)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [E2ETestController],
    }).compile();

    app = moduleFixture.createNestApplication();

    // To simulate Bước 1 [RED], before applying global pipes/interceptors/filters:
    // When enabled, it should pass all specifications.
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

  it('1. GET /test-api/single: Phản hồi single resource phải tự động bọc Unified Envelope', async () => {
    const res = await request(app.getHttpServer())
      .get('/test-api/single')
      .set('X-Request-Id', 'req_e2e_single_123')
      .expect(200);

    expect(res.headers['x-request-id']).toBe('req_e2e_single_123');
    expect(res.body.success).toBe(true);
    expect(res.body.code).toBe(200);
    expect(res.body.data).toEqual({ id: 'usr_01', name: 'Nguyen Van A' });
    expect(res.body.requestId).toBe('req_e2e_single_123');
    expect(res.body.timestamp).toBeDefined();
  });

  it('2. GET /test-api/paginated: Phản hồi danh sách phân trang phải giữ nguyên cấu trúc meta.pagination', async () => {
    const res = await request(app.getHttpServer())
      .get('/test-api/paginated?page=1')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.code).toBe(200);
    expect(res.body.message).toBe('Lấy danh sách thành công');
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBe(2);
    expect(res.body.meta.pagination.page).toBe(1);
    expect(res.body.meta.pagination.totalRecords).toBe(2);
  });

  it('3. POST /test-api/users: Khi dữ liệu DTO không hợp lệ, phải trả về HTTP 422 với invalidParams chuẩn RFC 9457', async () => {
    const res = await request(app.getHttpServer())
      .post('/test-api/users')
      .send({
        fullName: '',
        email: 'invalid-email',
        password: '123',
      })
      .expect(422);

    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe(422);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.errorCode).toBe('VALIDATION_FAILED');
    expect(res.body.error.type).toBe('https://api.famidoc.vn/errors/validation-failed');
    expect(res.body.error.instance).toBe('/test-api/users');
    expect(Array.isArray(res.body.error.invalidParams)).toBe(true);
    expect(res.body.error.invalidParams.length).toBeGreaterThanOrEqual(3);
  });

  it('4. GET /test-api/not-found: Khi ném ResourceNotFoundException, phải trả về HTTP 404 với Problem Details', async () => {
    const res = await request(app.getHttpServer())
      .get('/test-api/not-found')
      .expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe(404);
    expect(res.body.error.errorCode).toBe('USER_NOT_FOUND');
    expect(res.body.error.type).toBe('https://api.famidoc.vn/errors/user-not-found');
    expect(res.body.error.title).toBe('Resource Not Found');
    expect(res.body.error.detail).toBe('Người dùng không tồn tại');
  });
});
