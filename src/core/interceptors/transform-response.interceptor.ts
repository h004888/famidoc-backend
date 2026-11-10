import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { randomUUID } from 'crypto';
import { Request, Response } from 'express';
import { BYPASS_TRANSFORM_KEY } from '../decorators/bypass-transform.decorator';
import { RESPONSE_MESSAGE_KEY } from '../decorators/response-message.decorator';
import { ApiSuccessResponse } from '../types/api-response.interface';

@Injectable()
export class TransformResponseInterceptor<T>
  implements NestInterceptor<T, any>
{
  constructor(private readonly reflector: Reflector = new Reflector()) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const isBypass = this.reflector.getAllAndOverride<boolean>(
      BYPASS_TRANSFORM_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (isBypass) {
      return next.handle();
    }

    const customMessage = this.reflector.getAllAndOverride<string>(
      RESPONSE_MESSAGE_KEY,
      [context.getHandler(), context.getClass()],
    );

    const ctx = context.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const rawRequestId =
      (request?.headers?.['x-request-id'] as string) ||
      (request?.headers?.['x-correlation-id'] as string) ||
      (response?.getHeader?.('x-request-id') as string) ||
      (request as any)?.requestId ||
      randomUUID();

    if (request) {
      (request as any).requestId = rawRequestId;
    }

    if (response?.setHeader && !response.getHeader?.('x-request-id')) {
      response.setHeader('X-Request-Id', rawRequestId);
    }

    return next.handle().pipe(
      map((data) => {
        // Idempotency: nếu response đã có cấu trúc Unified Envelope thì giữ nguyên
        if (
          data &&
          typeof data === 'object' &&
          data.success === true &&
          typeof data.code === 'number' &&
          'data' in data
        ) {
          if (!data.requestId) {
            data.requestId = rawRequestId;
          }
          if (!data.timestamp) {
            data.timestamp = new Date().toISOString();
          }
          if (customMessage && (!data.message || data.message === 'Success')) {
            data.message = customMessage;
          }
          return data;
        }

        const statusCode = response?.statusCode || 200;
        const defaultMessage = customMessage || 'Success';

        // Nếu data trả về từ service/controller có phân tách data và meta (như phân trang)
        if (
          data &&
          typeof data === 'object' &&
          !Array.isArray(data) &&
          'data' in data &&
          'meta' in data
        ) {
          const res: ApiSuccessResponse<any> = {
            success: true,
            code: statusCode,
            message: (data as any).message ?? defaultMessage,
            data: (data as any).data,
            meta: (data as any).meta ?? null,
            timestamp: new Date().toISOString(),
            requestId: rawRequestId,
          };
          return res;
        }

        // Trường hợp single resource hoặc array thông thường
        const res: ApiSuccessResponse<any> = {
          success: true,
          code: statusCode,
          message:
            data &&
            typeof data === 'object' &&
            'message' in data &&
            typeof (data as any).message === 'string'
              ? (data as any).message
              : defaultMessage,
          data: data ?? null,
          meta: null,
          timestamp: new Date().toISOString(),
          requestId: rawRequestId,
        };
        return res;
      }),
    );
  }
}
