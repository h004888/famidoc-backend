import {
  HttpException,
  HttpStatus,
  ConflictException,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';

import { resolveErrorTypeUri, ValidationErrorCode } from '../constants/error-codes.constant';
import { InvalidParamItem, ProblemDetails } from '../types/api-response.interface';

export interface BaseApiExceptionOptions {
  errorCode: string;
  message: string;
  status?: HttpStatus;
  detail?: string;
  title?: string;
  typeUri?: string;
  invalidParams?: InvalidParamItem[];
}

export class BaseApiException extends HttpException {
  public readonly errorCode: string;
  public readonly detail: string;
  public readonly title: string;
  public readonly typeUri: string;
  public readonly invalidParams?: InvalidParamItem[];

  constructor(options: BaseApiExceptionOptions) {
    const status = options.status ?? HttpStatus.BAD_REQUEST;
    super(options.message, status);

    this.errorCode = options.errorCode;
    this.detail = options.detail ?? options.message;
    this.title = options.title ?? BaseApiException.getDefaultTitle(status);
    this.typeUri = options.typeUri ?? resolveErrorTypeUri(options.errorCode);
    this.invalidParams = options.invalidParams;
  }

  public static fromHttpException(exception: HttpException, defaultErrorCode = 'BAD_REQUEST'): BaseApiException {
    const status = exception.getStatus();
    const res = exception.getResponse();
    let message = exception.message;
    let detail = exception.message;
    let invalidParams: InvalidParamItem[] | undefined;

    if (typeof res === 'object' && res !== null) {
      const resObj = res as Record<string, any>;
      message = resObj.message || message;
      detail = resObj.error || message;
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
      type: this.typeUri,
      title: this.title,
      detail: this.detail,
      errorCode: this.errorCode,
      ...(instanceUri ? { instance: instanceUri } : {}),
      ...(this.invalidParams && this.invalidParams.length > 0
        ? { invalidParams: this.invalidParams }
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
  constructor(invalidParams: InvalidParamItem[], message = 'Dữ liệu đầu vào không hợp lệ') {
    super({
      errorCode: ValidationErrorCode.VALIDATION_FAILED,
      message,
      status: HttpStatus.UNPROCESSABLE_ENTITY,
      title: 'Unprocessable Content',
      detail: 'One or more fields in the request body failed validation constraints.',
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
  public readonly typeUri: string;
  public readonly invalidParams?: InvalidParamItem[];

  constructor(errorCode: string, message: string, detail?: string) {
    super(message);
    this.errorCode = errorCode;
    this.detail = detail ?? message;
    this.title = 'Conflict';
    this.typeUri = resolveErrorTypeUri(errorCode);
  }

  public toProblemDetails(instanceUri?: string): ProblemDetails {
    return {
      type: this.typeUri,
      title: this.title,
      detail: this.detail,
      errorCode: this.errorCode,
      ...(instanceUri ? { instance: instanceUri } : {}),
      ...(this.invalidParams && this.invalidParams.length > 0
        ? { invalidParams: this.invalidParams }
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
