import { of, lastValueFrom } from 'rxjs';
import { ExecutionContext, CallHandler } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TransformResponseInterceptor } from '../transform-response.interceptor';
import { BYPASS_TRANSFORM_KEY, BypassTransform } from '../../decorators/bypass-transform.decorator';

describe('TransformResponseInterceptor', () => {
  let interceptor: TransformResponseInterceptor;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    interceptor = new TransformResponseInterceptor(reflector);
  });

  function createMockContext(options?: {
    requestId?: string;
    statusCode?: number;
    bypass?: boolean;
  }): ExecutionContext {
    const headers: Record<string, string> = {};
    if (options?.requestId) {
      headers['x-request-id'] = options.requestId;
    }

    const resHeaders: Record<string, string> = {};
    const req = {
      headers,
    };
    const res = {
      statusCode: options?.statusCode ?? 200,
      setHeader: jest.fn((key: string, val: string) => {
        resHeaders[key] = val;
      }),
      getHeader: jest.fn((key: string) => resHeaders[key]),
    };

    return {
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => res,
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
  }

  it('nên bọc single resource vào Unified Envelope chuẩn', async () => {
    const context = createMockContext({ requestId: 'req_test_123', statusCode: 200 });
    const handler: CallHandler = {
      handle: () => of({ id: 'usr_1', name: 'Nguyen Van A' }),
    };

    const stream$ = interceptor.intercept(context, handler);
    const result = await lastValueFrom(stream$);

    expect(result.success).toBe(true);
    expect(result.code).toBe(200);
    expect(result.message).toBe('Success');
    expect(result.data).toEqual({ id: 'usr_1', name: 'Nguyen Van A' });
    expect(result.requestId).toBe('req_test_123');
    expect(typeof result.timestamp).toBe('string');
    expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('nên bảo toàn pagination meta khi controller trả về data và meta', async () => {
    const context = createMockContext({ statusCode: 200 });
    const payload = {
      data: [{ id: 1 }, { id: 2 }],
      meta: {
        pagination: {
          page: 1,
          pageSize: 20,
          totalRecords: 2,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      },
      message: 'Orders retrieved',
    };
    const handler: CallHandler = {
      handle: () => of(payload),
    };

    const stream$ = interceptor.intercept(context, handler);
    const result = await lastValueFrom(stream$);

    expect(result.success).toBe(true);
    expect(result.code).toBe(200);
    expect(result.message).toBe('Orders retrieved');
    expect(result.data).toEqual([{ id: 1 }, { id: 2 }]);
    expect(result.meta).toEqual(payload.meta);
  });

  it('nên bóc tách danh sách và chuẩn hóa pagination meta khi controller trả về items và meta', async () => {
    const context = createMockContext({ statusCode: 200 });
    const payload = {
      items: [{ id: 'doc-1', name: 'Dr. Strange' }],
      meta: {
        total: 15,
        page: 1,
        limit: 10,
        totalPages: 2,
      },
    };
    const handler: CallHandler = {
      handle: () => of(payload),
    };

    const stream$ = interceptor.intercept(context, handler);
    const result = await lastValueFrom(stream$);

    expect(result.success).toBe(true);
    expect(result.code).toBe(200);
    expect(result.data).toEqual([{ id: 'doc-1', name: 'Dr. Strange' }]);
    expect(result.meta).toEqual({
      pagination: {
        page: 1,
        pageSize: 10,
        totalRecords: 15,
        totalPages: 2,
        hasNextPage: true,
        hasPreviousPage: false,
      },
    });
  });

  it('nên bỏ qua đóng gói khi có cờ BypassTransform', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);

    const context = createMockContext();
    const rawBuffer = Buffer.from('PDF_CONTENT');
    const handler: CallHandler = {
      handle: () => of(rawBuffer),
    };

    const stream$ = interceptor.intercept(context, handler);
    const result = await lastValueFrom(stream$);

    expect(result).toBe(rawBuffer);
  });

  it('không nên bọc lặp hai lần nếu controller đã trả về cấu trúc Unified Envelope', async () => {
    const context = createMockContext({ requestId: 'existing_req_id' });
    const alreadyWrapped = {
      success: true,
      code: 201,
      message: 'Created',
      data: { id: 99 },
      timestamp: '2026-11-10T08:30:00.000Z',
      requestId: 'existing_req_id',
    };
    const handler: CallHandler = {
      handle: () => of(alreadyWrapped),
    };

    const stream$ = interceptor.intercept(context, handler);
    const result = await lastValueFrom(stream$);

    expect(result).toEqual(alreadyWrapped);
  });
});
