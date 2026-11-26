import {
  HttpException,
  HttpStatus,
  ConflictException,
} from '@nestjs/common';

import { ValidationErrorCode } from '../constants/error-codes.constant';
import {
  ErrorConditionItem,
  InvalidParamItem,
  ProblemDetails,
} from '../types/api-response.interface';

export interface BaseApiExceptionOptions {
  errorCode: string;
  message: string;
  status?: HttpStatus;
  detail?: string;
  title?: string;
  invalidParams?: InvalidParamItem[];
  conditions?: ErrorConditionItem[];
}

export class BaseApiException extends HttpException {
  public readonly errorCode: string;
  public readonly detail: string;
  public readonly title: string;
  public readonly invalidParams?: InvalidParamItem[];
  public readonly conditions?: ErrorConditionItem[];

  constructor(options: BaseApiExceptionOptions) {
    const status = options.status ?? HttpStatus.BAD_REQUEST;
    super(options.message, status);

    this.errorCode = options.errorCode;
    this.detail = options.detail ?? options.message;
    this.title = options.title ?? BaseApiException.getDefaultTitle(status);
    this.invalidParams = options.invalidParams;
    this.conditions = options.conditions;
  }

  public static fromHttpException(
    exception: HttpException,
    defaultErrorCode = 'BAD_REQUEST',
  ): BaseApiException {
    const status = exception.getStatus();
    const res = exception.getResponse();
    let message = exception.message;
    let detail = exception.message;
    let invalidParams: InvalidParamItem[] | undefined;

    if (typeof res === 'object' && res !== null) {
      const resObj = res as Record<string, any>;
      message = typeof resObj.message === 'string' ? resObj.message : message;
      detail = typeof resObj.detail === 'string' ? resObj.detail : message;
    }

    return new BaseApiException({
      errorCode: defaultErrorCode,
      message,
      detail,
      status,
      invalidParams,
    });
  }

  public toProblemDetails(instanceUri?: string): ProblemDetails {
    return {
      title: this.title,
      detail: this.detail,
      errorCode: this.errorCode,
      ...(instanceUri ? { instance: instanceUri } : {}),
      ...(this.invalidParams && this.invalidParams.length > 0
        ? { invalidParams: this.invalidParams }
        : {}),
      ...(this.conditions && this.conditions.length > 0
        ? { conditions: this.conditions }
        : {}),
    };
  }

  private static getDefaultTitle(status: HttpStatus): string {
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
}

export class ValidationException extends BaseApiException {
  constructor(
    invalidParams: InvalidParamItem[],
    message = 'Dữ liệu đầu vào không hợp lệ.',
  ) {
    const detail =
      invalidParams.length > 0
        ? invalidParams.map((item) => item.message).join(' ')
        : message;
    super({
      errorCode: ValidationErrorCode.VALIDATION_FAILED,
      message,
      status: HttpStatus.UNPROCESSABLE_ENTITY,
      title: 'Unprocessable Content',
      detail,
      invalidParams,
    });
  }
}

export class ResourceNotFoundException extends BaseApiException {
  constructor(errorCode: string, message: string, detail?: string) {
    super({
      errorCode,
      message,
      status: HttpStatus.NOT_FOUND,
      title: 'Resource Not Found',
      detail: detail ?? message,
    });
  }
}

export class BusinessConflictException extends ConflictException {
  public readonly errorCode: string;
  public readonly detail: string;
  public readonly title: string;
  public readonly invalidParams?: InvalidParamItem[];
  public readonly conditions?: ErrorConditionItem[];

  constructor(
    errorCode: string,
    message: string,
    detail?: string,
    options?: {
      invalidParams?: InvalidParamItem[];
      conditions?: ErrorConditionItem[];
    },
  ) {
    super(message);
    this.errorCode = errorCode;
    this.detail = detail ?? message;
    this.title = 'Conflict';
    this.invalidParams = options?.invalidParams;
    this.conditions = options?.conditions;
  }

  public toProblemDetails(instanceUri?: string): ProblemDetails {
    return {
      title: this.title,
      detail: this.detail,
      errorCode: this.errorCode,
      ...(instanceUri ? { instance: instanceUri } : {}),
      ...(this.invalidParams && this.invalidParams.length > 0
        ? { invalidParams: this.invalidParams }
        : {}),
      ...(this.conditions && this.conditions.length > 0
        ? { conditions: this.conditions }
        : {}),
    };
  }
}

export class UnauthorizedApiException extends BaseApiException {
  constructor(errorCode: string, message: string, detail?: string) {
    super({
      errorCode,
      message,
      status: HttpStatus.UNAUTHORIZED,
      title: 'Unauthorized',
      detail: detail ?? message,
    });
  }
}

export class ForbiddenApiException extends BaseApiException {
  constructor(errorCode: string, message: string, detail?: string) {
    super({
      errorCode,
      message,
      status: HttpStatus.FORBIDDEN,
      title: 'Forbidden',
      detail: detail ?? message,
    });
  }
}
