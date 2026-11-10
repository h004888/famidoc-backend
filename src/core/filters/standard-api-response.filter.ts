import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { BaseApiException } from '../exceptions/api.exception';
import {
  InvalidParamItem,
  ProblemDetails,
  ApiErrorResponse,
} from '../types/api-response.interface';
import {
  ValidationErrorCode,
  ValidationIssue,
  SystemErrorCode,
  resolveErrorTypeUri,
} from '../constants/error-codes.constant';

@Catch()
export class StandardApiResponseFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

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


    const instance = request?.originalUrl || request?.url || '';

    // Trường hợp 1: BaseApiException hoặc Custom Exception có toProblemDetails
    if (
      exception instanceof BaseApiException ||
      typeof (exception as any)?.toProblemDetails === 'function'
    ) {
      const ex = exception as any;
      const status = typeof ex.getStatus === 'function' ? ex.getStatus() : HttpStatus.BAD_REQUEST;
      const problem = ex.toProblemDetails(instance);

      const errorPayload: ApiErrorResponse = {
        success: false,
        code: status,
        message: ex.message,
        data: null,
        meta: null,
        error: problem,
        timestamp: new Date().toISOString(),
        requestId: rawRequestId,
      };

      response.status(status).json(errorPayload);
      return;
    }


    // Trường hợp 2: HttpException thông thường của NestJS
    if (exception instanceof HttpException) {
      let status = exception.getStatus();
      const res = exception.getResponse();
      let message = exception.message || 'Error occurred';
      let detail = message;
      let errorCode = 'BAD_REQUEST';
      let invalidParams: InvalidParamItem[] | undefined;

      if (typeof res === 'object' && res !== null) {
        const resObj = res as Record<string, any>;
        // Xử lý lỗi validation từ class-validator
        if (Array.isArray(resObj.message)) {
          status = HttpStatus.UNPROCESSABLE_ENTITY;
          errorCode = ValidationErrorCode.VALIDATION_FAILED;
          message = resObj.message[0] || 'Dữ liệu đầu vào không hợp lệ';
          detail = 'One or more fields in the request failed validation constraints.';
          invalidParams = this.extractValidationErrors(resObj.message);
        } else {
          message = resObj.message || message;
          detail = resObj.error || message;
          errorCode = resObj.errorCode || this.mapStatusToErrorCode(status);
        }
      } else if (typeof res === 'string') {
        message = res;
        detail = res;
        errorCode = this.mapStatusToErrorCode(status);
      }

      const problem: ProblemDetails = {
        type: resolveErrorTypeUri(errorCode),
        title: this.mapStatusToTitle(status),
        detail,
        errorCode,
        instance,
        ...(invalidParams ? { invalidParams } : {}),
      };

      const errorPayload: ApiErrorResponse = {
        success: false,
        code: status,
        message,
        data: null,
        meta: null,
        error: problem,
        timestamp: new Date().toISOString(),
        requestId: rawRequestId,
      };

      response.status(status).json(errorPayload);
      return;
    }

    // Trường hợp 3: Lỗi hệ thống ngoài dự kiến (500 Unhandled Exception)
    const status = HttpStatus.INTERNAL_SERVER_ERROR;
    const errorCode = SystemErrorCode.INTERNAL_SERVER_ERROR;
    const problem: ProblemDetails = {
      type: resolveErrorTypeUri(errorCode),
      title: 'Internal Server Error',
      detail: 'An unexpected internal server error occurred.',
      errorCode,
      instance,
    };

    const errorPayload: ApiErrorResponse = {
      success: false,
      code: status,
      message: 'Internal server error',
      data: null,
      meta: null,
      error: problem,
      timestamp: new Date().toISOString(),
      requestId: rawRequestId,
    };

    response.status(status).json(errorPayload);
  }

  private extractValidationErrors(messages: string[]): InvalidParamItem[] {
    return messages.map((msgStr) => {
      const parts = msgStr.trim().split(' ');
      let field = parts[0] || 'unknown';
      if (parts[0] === 'property' && parts[2] === 'should' && parts[3] === 'not') {
        field = parts[1] || 'unknown';
      }
      let issue = ValidationIssue.INVALID_FORMAT;

      const lower = msgStr.toLowerCase();
      if (lower.includes('should not be empty') || lower.includes('must not be empty') || lower.includes('required')) {
        issue = ValidationIssue.REQUIRED;
      } else if (lower.includes('must be longer') || lower.includes('minlength')) {
        issue = ValidationIssue.MIN_LENGTH;
      } else if (lower.includes('must be shorter') || lower.includes('maxlength')) {
        issue = ValidationIssue.MAX_LENGTH;
      } else if (lower.includes('must be greater') || lower.includes('min')) {
        issue = ValidationIssue.MIN_VALUE;
      } else if (lower.includes('must be less') || lower.includes('max')) {
        issue = ValidationIssue.MAX_VALUE;
      } else if (lower.includes('must be an email') || lower.includes('format')) {
        issue = ValidationIssue.INVALID_FORMAT;
      } else if (lower.includes('must be an integer') || lower.includes('must be a string') || lower.includes('must be a boolean')) {
        issue = ValidationIssue.INVALID_TYPE;
      }

      return {
        field,
        issue,
        message: msgStr,
      };
    });
  }

  private mapStatusToTitle(status: HttpStatus): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return 'Bad Request';
      case HttpStatus.UNAUTHORIZED:
        return 'Unauthorized';
      case HttpStatus.FORBIDDEN:
        return 'Forbidden';
      case HttpStatus.NOT_FOUND:
        return 'Resource Not Found';
      case HttpStatus.CONFLICT:
        return 'Conflict';
      case HttpStatus.UNPROCESSABLE_ENTITY:
        return 'Unprocessable Content';
      case HttpStatus.TOO_MANY_REQUESTS:
        return 'Too Many Requests';
      case HttpStatus.INTERNAL_SERVER_ERROR:
        return 'Internal Server Error';
      default:
        return 'HTTP Error';
    }
  }

  private mapStatusToErrorCode(status: HttpStatus): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return 'BAD_REQUEST';
      case HttpStatus.UNAUTHORIZED:
        return 'AUTH_UNAUTHORIZED';
      case HttpStatus.FORBIDDEN:
        return 'AUTH_FORBIDDEN';
      case HttpStatus.NOT_FOUND:
        return 'RESOURCE_NOT_FOUND';
      case HttpStatus.CONFLICT:
        return 'CONFLICT_ERROR';
      case HttpStatus.TOO_MANY_REQUESTS:
        return 'AUTH_RATE_LIMIT_EXCEEDED';
      case HttpStatus.UNPROCESSABLE_ENTITY:
        return ValidationErrorCode.VALIDATION_FAILED;
      default:
        return SystemErrorCode.INTERNAL_SERVER_ERROR;
    }
  }
}
