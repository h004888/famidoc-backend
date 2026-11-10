import { HttpStatus, BadRequestException } from '@nestjs/common';
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

    const res = {
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
    expect(json.requestId).toBe('req_123');
    expect(json.error).toEqual({
      type: 'https://api.famidoc.vn/errors/user-not-found',
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
    });
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
});
