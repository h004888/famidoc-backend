import { HttpStatus } from '@nestjs/common';
import {
  BaseApiException,
  ValidationException,
  ResourceNotFoundException,
  BusinessConflictException,
  UnauthorizedApiException,
  ForbiddenApiException,
} from '../api.exception';

describe('BaseApiException & Domain Exceptions', () => {
  it('BaseApiException nên lưu trữ đúng các thuộc tính chuẩn RFC 9457', () => {
    const ex = new BaseApiException({
      errorCode: 'CUSTOM_ERROR',
      message: 'A custom error occurred',
      status: HttpStatus.BAD_REQUEST,
      detail: 'Detailed explanation',
      title: 'Custom Title',
    });

    expect(ex.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect(ex.errorCode).toBe('CUSTOM_ERROR');
    expect(ex.message).toBe('A custom error occurred');
    expect(ex.detail).toBe('Detailed explanation');
    expect(ex.title).toBe('Custom Title');

    const problem = ex.toProblemDetails('/api/v1/test');
    expect(problem.type).toBe('https://api.famidoc.vn/errors/custom-error');
    expect(problem.title).toBe('Custom Title');
    expect(problem.detail).toBe('Detailed explanation');
    expect(problem.errorCode).toBe('CUSTOM_ERROR');
    expect(problem.instance).toBe('/api/v1/test');
  });

  it('ValidationException nên có status 422 và chứa danh sách invalidParams chuẩn', () => {
    const invalidParams = [
      {
        field: 'email',
        issue: 'INVALID_FORMAT',
        message: 'Email must be valid',
        rejectedValue: 'abc@',
      },
    ];
    const ex = new ValidationException(invalidParams, 'Validation failed');

    expect(ex.getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(ex.errorCode).toBe('VALIDATION_FAILED');
    expect(ex.invalidParams).toEqual(invalidParams);

    const problem = ex.toProblemDetails();
    expect(problem.errorCode).toBe('VALIDATION_FAILED');
    expect(problem.invalidParams).toEqual(invalidParams);
  });

  it('ResourceNotFoundException nên có status 404', () => {
    const ex = new ResourceNotFoundException('USER_NOT_FOUND', 'User does not exist');
    expect(ex.getStatus()).toBe(HttpStatus.NOT_FOUND);
    expect(ex.errorCode).toBe('USER_NOT_FOUND');
    expect(ex.title).toBe('Resource Not Found');
  });

  it('BusinessConflictException nên có status 409', () => {
    const ex = new BusinessConflictException('CONTRACT_INVALID_STATUS', 'Contract is expired');
    expect(ex.getStatus()).toBe(HttpStatus.CONFLICT);
    expect(ex.errorCode).toBe('CONTRACT_INVALID_STATUS');
    expect(ex.title).toBe('Conflict');
  });

  it('UnauthorizedApiException và ForbiddenApiException nên có đúng status tương ứng', () => {
    const unauth = new UnauthorizedApiException('AUTH_UNAUTHORIZED', 'Invalid token');
    expect(unauth.getStatus()).toBe(HttpStatus.UNAUTHORIZED);

    const forbidden = new ForbiddenApiException('AUTH_FORBIDDEN', 'Access denied');
    expect(forbidden.getStatus()).toBe(HttpStatus.FORBIDDEN);
  });
});
