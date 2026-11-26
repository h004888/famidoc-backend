import {
  HttpStatus,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { StandardApiResponseFilter } from '../standard-api-response.filter';
import { ResourceNotFoundException, ValidationException } from '../../exceptions/api.exception';

describe('StandardApiResponseFilter (RFC 9457 Compliance)', () => {
  let filter: StandardApiResponseFilter;

  beforeEach(() => {
    filter = new StandardApiResponseFilter();
  });

  function createMockArgumentsHost(options?: {
    requestId?: string;
    url?: string;
  }) {
    const headers: Record<string, string> = {};
    if (options?.requestId) {
      headers['x-request-id'] = options.requestId;
    }

    let jsonResponse: any = null;
    let statusCode: number = 200;
    const resHeaders: Record<string, string> = {};

    const req = {
      headers,
      url: options?.url ?? '/api/v1/test',
      originalUrl: options?.url ?? '/api/v1/test',
    };

    const res: any = {
      status: jest.fn((code: number) => {
        statusCode = code;
        return res;
      }),
      json: jest.fn((payload: any) => {
        jsonResponse = payload;
        return res;
      }),
      setHeader: jest.fn((key: string, val: string) => {
        resHeaders[key] = val;
      }),
    };

    return {
      host: {
        switchToHttp: () => ({
          getRequest: () => req,
          getResponse: () => res,
        }),
      } as any,
      getJson: () => jsonResponse,
      getStatus: () => statusCode,
      getHeaders: () => resHeaders,
    };
  }

  it('nên xử lý BaseApiException và trả về Problem Details chuẩn RFC 9457', () => {
    const { host, getJson, getStatus } = createMockArgumentsHost({
      requestId: 'req_123',
      url: '/api/v1/users/usr_404',
    });

    const ex = new ResourceNotFoundException('USER_NOT_FOUND', 'Người dùng không tồn tại');
    filter.catch(ex, host);

    expect(getStatus()).toBe(HttpStatus.NOT_FOUND);
    const json = getJson();
    expect(json.success).toBe(false);
    expect(json.code).toBe(HttpStatus.NOT_FOUND);
    expect(json).not.toHaveProperty('message');
    expect(json.requestId).toBe('req_123');
    expect(json.error).toEqual({
      title: 'Resource Not Found',
      detail: 'Người dùng không tồn tại',
      errorCode: 'USER_NOT_FOUND',
      instance: '/api/v1/users/usr_404',
    });
  });

  it('nên xử lý BadRequestException từ class-validator và trả về invalidParams chuẩn', () => {
    const { host, getJson, getStatus } = createMockArgumentsHost({
      url: '/api/v1/auth/register',
    });

    const validationMessages = [
      'email must be an email',
      'password must be longer than or equal to 8 characters',
    ];
    const ex = new BadRequestException(validationMessages);
    filter.catch(ex, host);

    expect(getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    const json = getJson();
    expect(json.success).toBe(false);
    expect(json.code).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(json.error.errorCode).toBe('VALIDATION_FAILED');
    expect(json.error.instance).toBe('/api/v1/auth/register');
    expect(Array.isArray(json.error.invalidParams)).toBe(true);
    expect(json.error.invalidParams.length).toBe(2);
    expect(json.error.invalidParams[0]).toMatchObject({
      field: 'email',
      issue: 'INVALID_FORMAT',
      message: 'Email không đúng định dạng email.',
    });
    expect(json.error.invalidParams[1]).toMatchObject({
      field: 'password',
      issue: 'MIN_LENGTH',
      message: 'Mật khẩu phải có ít nhất 8 ký tự.',
    });
    expect(json.error).not.toHaveProperty('type');
    expect(json).not.toHaveProperty('message');
  });

  it('nên bắt lỗi không mong muốn (500) và không làm lộ stack trace', () => {
    const { host, getJson, getStatus } = createMockArgumentsHost();

    const ex = new Error('Database password is root123');
    filter.catch(ex, host);

    expect(getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    const json = getJson();
    expect(json.success).toBe(false);
    expect(json.code).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(json.error.errorCode).toBe('INTERNAL_SERVER_ERROR');
    expect(json.error.detail).not.toContain('root123');
  });

  it('nên bảo toàn blockingReasons trong ProblemDetails khi HttpException trả 409 Conflict', () => {
    const { host, getJson, getStatus } = createMockArgumentsHost({
      url: '/api/v1/payments/requests',
    });

    const ex = new ConflictException({
      message: 'Contract is not ready for payment',
      blockingReasons: ['DOCTOR_VERIFICATION_REQUIRED'],
    });
    filter.catch(ex, host);

    expect(getStatus()).toBe(HttpStatus.CONFLICT);
    const json = getJson();
    expect(json.success).toBe(false);
    expect(json.code).toBe(HttpStatus.CONFLICT);
    expect(json.error.errorCode).toBe('CONFLICT_ERROR');
    expect(json.error.detail).toBe('Dữ liệu đang xung đột với trạng thái hiện tại.');
    expect(json.error.blockingReasons).toEqual(['DOCTOR_VERIFICATION_REQUIRED']);
  });

  it('giữ mã hồ sơ đã có trong phản hồi báo trùng 409', () => {
    const { host, getJson, getStatus } = createMockArgumentsHost({
      url: '/api/v1/support-cases/payment-issue',
    });

    filter.catch(new ConflictException({
      message: 'Hồ sơ đã tồn tại.',
      existingCaseId: '88888888-8888-4888-8888-888888888888',
    }), host);

    expect(getStatus()).toBe(HttpStatus.CONFLICT);
    expect(getJson().error.existingCaseId).toBe('88888888-8888-4888-8888-888888888888');
  });

  it('không gắn blockingReasons khi payload không có hoặc là mảng rỗng', () => {
    const withoutReasons = createMockArgumentsHost({ url: '/api/v1/payments/requests' });
    filter.catch(new ConflictException('Contract is not ready for payment'), withoutReasons.host);
    expect(withoutReasons.getJson().error).not.toHaveProperty('blockingReasons');

    const emptyReasons = createMockArgumentsHost({ url: '/api/v1/payments/requests' });
    filter.catch(
      new ConflictException({
        message: 'Contract is not ready for payment',
        blockingReasons: [],
      }),
      emptyReasons.host,
    );
    expect(emptyReasons.getJson().error).not.toHaveProperty('blockingReasons');
  });

  it('nên tự động suy luận domain error code theo URL instance khi nhận HttpException thuần', () => {
    // 1. NotFoundException tại /api/v1/contracts/123 -> CONTRACT_NOT_FOUND
    const hostContract = createMockArgumentsHost({ url: '/api/v1/contracts/123' });
    filter.catch(new NotFoundException('Hợp đồng không tồn tại'), hostContract.host);
    expect(hostContract.getJson().error.errorCode).toBe('CONTRACT_NOT_FOUND');

    // 2. NotFoundException tại /api/v1/doctors/456 -> DOCTOR_NOT_FOUND
    const hostDoctor = createMockArgumentsHost({ url: '/api/v1/doctors/456' });
    filter.catch(new NotFoundException('Bác sĩ không tồn tại'), hostDoctor.host);
    expect(hostDoctor.getJson().error.errorCode).toBe('DOCTOR_NOT_FOUND');

    // 3. NotFoundException tại /api/v1/care-packages/789 -> CARE_PACKAGE_NOT_FOUND
    const hostPackage = createMockArgumentsHost({ url: '/api/v1/care-packages/789' });
    filter.catch(new NotFoundException('Gói không tồn tại'), hostPackage.host);
    expect(hostPackage.getJson().error.errorCode).toBe('CARE_PACKAGE_NOT_FOUND');

    // 4. NotFoundException tại /api/v1/unknown -> RESOURCE_NOT_FOUND
    const hostUnknown = createMockArgumentsHost({ url: '/api/v1/unknown' });
    filter.catch(new NotFoundException('Không tìm thấy tài nguyên'), hostUnknown.host);
    expect(hostUnknown.getJson().error.errorCode).toBe('RESOURCE_NOT_FOUND');
  });

  it('nên bắt lỗi Prisma P2002 sang 409 DB_UNIQUE_VIOLATION kèm invalidParams tiếng Việt', () => {
    const { host, getJson, getStatus } = createMockArgumentsHost({
      url: '/api/v1/admin/care-packages',
    });

    filter.catch(
      { code: 'P2002', meta: { target: ['package_code'] }, message: 'Unique constraint failed' },
      host,
    );

    expect(getStatus()).toBe(HttpStatus.CONFLICT);
    const json = getJson();
    expect(json.error.errorCode).toBe('DB_UNIQUE_VIOLATION');
    expect(json.error.invalidParams).toEqual([
      {
        field: 'package_code',
        issue: 'DUPLICATE',
        message: 'Mã gói đã tồn tại trong hệ thống.',
      },
    ]);
  });

  it('nên map lỗi constraint service_packages_schedule_cap_chk sang thông báo tiếng Việt mới', () => {
    const { host, getJson, getStatus } = createMockArgumentsHost({
      url: '/api/v1/admin/care-packages',
    });

    filter.catch(
      { message: 'new row for relation "service_packages" violates check constraint "service_packages_schedule_cap_chk"' },
      host,
    );

    expect(getStatus()).toBe(HttpStatus.BAD_REQUEST);
    const json = getJson();
    expect(json.error.errorCode).toBe('DB_CONSTRAINT_VIOLATION');
    expect(json.error.detail).toContain('ít nhất 1 lượt khám nhà, 1 lượt tư vấn video');
    expect(json.error.detail).not.toContain('500.000');
  });

  it('nên bóc đúng field và message tiếng Việt khi NestJS ValidationPipe thêm prefix quotas.', () => {
    const { host, getJson, getStatus } = createMockArgumentsHost({
      url: '/api/v1/admin/care-packages',
    });

    filter.catch(
      new BadRequestException([
        'quotas.Số lượt khám tại nhà phải lớn hơn 0.',
        'quotas.Số lượt tư vấn video phải lớn hơn 0.',
      ]),
      host,
    );

    expect(getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(getJson().error.invalidParams).toEqual([
      {
        field: 'quotas.homeVisits',
        issue: 'MIN_VALUE',
        message: 'Số lượt khám tại nhà phải lớn hơn 0.',
      },
      {
        field: 'quotas.videoConsultations',
        issue: 'MIN_VALUE',
        message: 'Số lượt tư vấn video phải lớn hơn 0.',
      },
    ]);
  });
});
