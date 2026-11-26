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
  ErrorConditionItem,
  InvalidParamItem,
  ProblemDetails,
  ApiErrorResponse,
} from '../types/api-response.interface';
import {
  ValidationErrorCode,
  ValidationIssue,
  SystemErrorCode,
  ContractErrorCode,
  DoctorErrorCode,
  CarePackageErrorCode,
  PaymentErrorCode,
  AuthErrorCode,
} from '../constants/error-codes.constant';

interface DomainRouteRule {
  pattern: RegExp;
  statusMap: Partial<Record<HttpStatus, string>>;
}

const DOMAIN_ROUTE_RULES: DomainRouteRule[] = [
  {
    pattern: /\/api\/v1\/contracts/i,
    statusMap: {
      [HttpStatus.NOT_FOUND]: ContractErrorCode.CONTRACT_NOT_FOUND,
      [HttpStatus.FORBIDDEN]: ContractErrorCode.CONTRACT_PERMISSION_DENIED,
    },
  },
  {
    pattern: /\/api\/v1\/doctors/i,
    statusMap: {
      [HttpStatus.NOT_FOUND]: DoctorErrorCode.DOCTOR_NOT_FOUND,
    },
  },
  {
    pattern: /\/api\/v1\/(?:admin\/)?care-packages/i,
    statusMap: {
      [HttpStatus.NOT_FOUND]: CarePackageErrorCode.CARE_PACKAGE_NOT_FOUND,
    },
  },
  {
    pattern: /\/api\/v1\/payments/i,
    statusMap: {
      [HttpStatus.NOT_FOUND]: PaymentErrorCode.PAYMENT_TRANSACTION_NOT_FOUND,
    },
  },
  {
    pattern: /\/api\/v1\/auth/i,
    statusMap: {
      [HttpStatus.UNAUTHORIZED]: AuthErrorCode.AUTH_UNAUTHORIZED,
      [HttpStatus.FORBIDDEN]: AuthErrorCode.AUTH_FORBIDDEN,
    },
  },
];

const FIELD_LABELS: Record<string, string> = {
  code: 'Mã gói',
  package_code: 'Mã gói',
  packageCode: 'Mã gói',
  lineage_code: 'Mã gói',
  name: 'Tên gói',
  description: 'Mô tả',
  durationMonths: 'Kỳ hạn (tháng)',
  priceVnd: 'Giá gói',
  includedMembers: 'Số thành viên trong giá gói',
  maxMembers: 'Số thành viên tối đa',
  additionalMemberMonthlyPriceVnd: 'Phụ phí thêm thành viên/tháng',
  quotaPeriod: 'Kỳ áp dụng hạn mức',
  homeVisitUnitPriceVnd: 'Đơn giá lượt khám tại nhà',
  quotas: 'Hạn mức quyền lợi gói',
  'quotas.homeVisits': 'Số lượt khám tại nhà',
  'quotas.videoConsultations': 'Số lượt tư vấn video',
  homeVisits: 'Số lượt khám tại nhà',
  videoConsultations: 'Số lượt tư vấn video',
  packageId: 'Mã định danh gói',
  email: 'Email',
  phone: 'Số điện thoại',
  password: 'Mật khẩu',
  fullName: 'Họ và tên',
  page: 'Trang',
  limit: 'Số lượng mỗi trang',
  status: 'Trạng thái',
};

const KNOWN_ENGLISH_MESSAGES: Record<string, string> = {
  'bad request': 'Yêu cầu không hợp lệ.',
  unauthorized: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại.',
  forbidden: 'Bạn không có quyền thực hiện thao tác này.',
  'forbidden resource': 'Bạn không có quyền thực hiện thao tác này.',
  'not found': 'Không tìm thấy tài nguyên yêu cầu.',
  conflict: 'Dữ liệu đang xung đột với trạng thái hiện tại.',
  'too many requests': 'Bạn đã gửi quá nhiều yêu cầu. Vui lòng thử lại sau.',
  'internal server error': 'Hệ thống đang gặp sự cố không mong muốn. Vui lòng thử lại sau.',
  'validation failed (uuid v 4 is expected)': 'Mã định danh (UUID) không đúng định dạng.',
  'validation failed (uuid is expected)': 'Mã định danh (UUID) không đúng định dạng.',
  'package code exists; create a new version instead':
    'Mã gói đã tồn tại. Vui lòng chọn mã khác hoặc tạo phiên bản mới.',
  'package version changed or a draft already exists':
    'Phiên bản gói đã thay đổi hoặc đã tồn tại bản nháp.',
  'care package not found': 'Không tìm thấy gói dịch vụ.',
  'cannot edit a deprecated package': 'Không thể chỉnh sửa gói dịch vụ đã ngừng bán.',
  'provide at least one field to update': 'Vui lòng cung cấp ít nhất một trường cần cập nhật.',
  'maxmembers cannot be below includedmembers':
    'Số thành viên tối đa không được nhỏ hơn số thành viên đã bao gồm trong giá gói.',
  'additional-member fee must be zero when extra members are disabled':
    'Phụ phí thêm thành viên phải bằng 0 khi gói không cho phép thêm thành viên.',
  'a package must include at least one consultation or visit':
    'Gói dịch vụ phải bao gồm ít nhất một lượt khám hoặc tư vấn.',
};

const VIETNAMESE_CHAR_REGEX =
  /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;

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
      const status =
        typeof ex.getStatus === 'function' ? ex.getStatus() : HttpStatus.BAD_REQUEST;
      const problem: ProblemDetails = ex.toProblemDetails(instance);
      delete (problem as any).type;
      problem.detail = this.ensureVietnameseDetail(problem.detail, status);

      const errorPayload: ApiErrorResponse = {
        success: false,
        code: status,
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
      let detail = exception.message || this.defaultVietnameseMessage(status);
      let errorCode = 'BAD_REQUEST';
      let invalidParams: InvalidParamItem[] | undefined;
      let conditions: ErrorConditionItem[] | undefined;
      let blockingReasons: string[] | undefined;
      let existingCaseId: string | undefined;

      if (typeof res === 'object' && res !== null) {
        const resObj = res as Record<string, any>;
        if (
          status === HttpStatus.CONFLICT &&
          typeof resObj.existingCaseId === 'string'
        ) {
          existingCaseId = resObj.existingCaseId;
        }
        if (
          Array.isArray(resObj.blockingReasons) &&
          resObj.blockingReasons.length > 0
        ) {
          blockingReasons = resObj.blockingReasons.filter(
            (reason: unknown): reason is string => typeof reason === 'string',
          );
        }

        // Xử lý lỗi validation từ class-validator
        if (Array.isArray(resObj.message)) {
          status = HttpStatus.UNPROCESSABLE_ENTITY;
          errorCode = ValidationErrorCode.VALIDATION_FAILED;
          invalidParams = this.extractValidationErrors(resObj.message);
          detail =
            invalidParams.length > 0
              ? invalidParams.map((item) => item.message).join(' ')
              : 'Dữ liệu đầu vào không hợp lệ.';
        } else {
          const rawMsg =
            typeof resObj.detail === 'string' && resObj.detail.trim()
              ? resObj.detail
              : typeof resObj.message === 'string' && resObj.message.trim()
                ? resObj.message
                : detail;
          detail = this.ensureVietnameseDetail(rawMsg, status);
          errorCode =
            (typeof resObj.errorCode === 'string' && resObj.errorCode) ||
            (typeof resObj.code === 'string' && resObj.code) ||
            this.resolveContextualErrorCode(status, instance, resObj);
          conditions = this.extractConditions(resObj);
        }
      } else if (typeof res === 'string') {
        detail = this.ensureVietnameseDetail(res, status);
        errorCode = this.resolveContextualErrorCode(status, instance, res);
      }

      const problem: ProblemDetails = {
        title: this.mapStatusToTitle(status),
        errorCode,
        detail,
        instance,
        ...(invalidParams && invalidParams.length > 0 ? { invalidParams } : {}),
        ...(conditions && conditions.length > 0 ? { conditions } : {}),
        ...(blockingReasons ? { blockingReasons } : {}),
        ...(existingCaseId ? { existingCaseId } : {}),
      };

      const errorPayload: ApiErrorResponse = {
        success: false,
        code: status,
        data: null,
        meta: null,
        error: problem,
        timestamp: new Date().toISOString(),
        requestId: rawRequestId,
      };

      response.status(status).json(errorPayload);
      return;
    }

    // Trường hợp 3: Lỗi cơ sở dữ liệu Prisma (P2002, P2003, P2025, check constraint)
    const prismaMapped = this.mapPrismaException(exception, instance);
    if (prismaMapped) {
      const errorPayload: ApiErrorResponse = {
        success: false,
        code: prismaMapped.status,
        data: null,
        meta: null,
        error: prismaMapped.problem,
        timestamp: new Date().toISOString(),
        requestId: rawRequestId,
      };

      response.status(prismaMapped.status).json(errorPayload);
      return;
    }

    // Trường hợp 4: Lỗi hệ thống ngoài dự kiến (500 Unhandled Exception)
    const status = HttpStatus.INTERNAL_SERVER_ERROR;
    const errorCode = SystemErrorCode.INTERNAL_SERVER_ERROR;
    const problem: ProblemDetails = {
      title: 'Internal Server Error',
      errorCode,
      detail: 'Hệ thống đang gặp sự cố không mong muốn. Vui lòng thử lại sau.',
      instance,
    };

    const errorPayload: ApiErrorResponse = {
      success: false,
      code: status,
      data: null,
      meta: null,
      error: problem,
      timestamp: new Date().toISOString(),
      requestId: rawRequestId,
    };

    response.status(status).json(errorPayload);
  }

  private mapPrismaException(
    exception: unknown,
    instance: string,
  ): { status: HttpStatus; problem: ProblemDetails } | null {
    if (!exception || typeof exception !== 'object') return null;
    const err = exception as Record<string, any>;
    const code = typeof err.code === 'string' ? err.code : '';
    const message = typeof err.message === 'string' ? err.message : '';

    if (code === 'P2002') {
      const targetRaw = err.meta?.target;
      const targets: string[] = Array.isArray(targetRaw)
        ? targetRaw.map(String)
        : typeof targetRaw === 'string'
          ? [targetRaw]
          : [];
      const invalidParams: InvalidParamItem[] = targets.map((field) => ({
        field,
        issue: ValidationIssue.DUPLICATE,
        message: `${this.getFieldLabel(field)} đã tồn tại trong hệ thống.`,
      }));
      const detail =
        invalidParams.length > 0
          ? invalidParams.map((item) => item.message).join(' ')
          : 'Dữ liệu bị trùng lặp, vui lòng kiểm tra lại.';
      return {
        status: HttpStatus.CONFLICT,
        problem: {
          title: 'Conflict',
          errorCode: SystemErrorCode.DB_UNIQUE_VIOLATION,
          detail,
          instance,
          ...(invalidParams.length > 0 ? { invalidParams } : {}),
        },
      };
    }

    if (code === 'P2003') {
      const field = typeof err.meta?.field_name === 'string' ? err.meta.field_name : 'dữ liệu liên kết';
      return {
        status: HttpStatus.BAD_REQUEST,
        problem: {
          title: 'Bad Request',
          errorCode: SystemErrorCode.DB_FOREIGN_KEY_VIOLATION,
          detail: `Không tìm thấy bản ghi liên kết hợp lệ cho ${this.getFieldLabel(field)}.`,
          instance,
        },
      };
    }

    if (code === 'P2025') {
      return {
        status: HttpStatus.NOT_FOUND,
        problem: {
          title: 'Resource Not Found',
          errorCode: this.resolveContextualErrorCode(HttpStatus.NOT_FOUND, instance),
          detail: 'Không tìm thấy dữ liệu yêu cầu.',
          instance,
        },
      };
    }

    if (message.includes('service_packages_schedule_cap_chk')) {
      return {
        status: HttpStatus.BAD_REQUEST,
        problem: {
          title: 'Bad Request',
          errorCode: SystemErrorCode.DB_CONSTRAINT_VIOLATION,
          detail:
            'Hạn mức lượt khám của gói vi phạm giới hạn hệ thống (cần ít nhất 1 lượt khám nhà, 1 lượt tư vấn video và tổng không vượt quá 7 lượt/tháng).',
          instance,
        },
      };
    }

    if (message.includes('23514')) {
      return {
        status: HttpStatus.BAD_REQUEST,
        problem: {
          title: 'Bad Request',
          errorCode: SystemErrorCode.DB_CONSTRAINT_VIOLATION,
          detail: 'Dữ liệu vi phạm ràng buộc kiểm tra của cơ sở dữ liệu.',
          instance,
        },
      };
    }

    return null;
  }

  private extractConditions(resObj: Record<string, any>): ErrorConditionItem[] | undefined {
    if (Array.isArray(resObj.conditions) && resObj.conditions.length > 0) {
      return resObj.conditions
        .filter((item): item is Record<string, any> => Boolean(item && typeof item === 'object'))
        .map((item) => ({
          code: String(item.code ?? 'CONDITION'),
          condition: String(item.condition ?? item.code ?? ''),
          message: this.ensureVietnameseDetail(String(item.message ?? ''), HttpStatus.BAD_REQUEST),
        }));
    }

    if (Array.isArray(resObj.findings) && resObj.findings.length > 0) {
      const requiredAck = Array.isArray(resObj.requiresAcknowledgement)
        ? new Set(resObj.requiresAcknowledgement.map(String))
        : new Set<string>();
      return resObj.findings
        .filter((item): item is Record<string, any> => Boolean(item && typeof item === 'object'))
        .map((item) => {
          const code = String(item.code ?? 'RULE');
          const condition = requiredAck.has(code)
            ? `acknowledgedWarnings phải chứa ${code}`
            : `Quy tắc ${code}`;
          return {
            code,
            condition,
            message: String(item.message ?? ''),
          };
        });
    }

    return undefined;
  }

  private extractValidationErrors(messages: string[]): InvalidParamItem[] {
    return messages.map((msgStr) => {
      const trimmed = String(msgStr).trim();
      const parts = trimmed.split(' ');
      let field = parts[0] || 'unknown';
      if (parts[0] === 'property' && parts[2] === 'should' && parts[3] === 'not') {
        field = parts[1] || 'unknown';
      }

      // Khi NestJS ValidationPipe bọc prefix nested (vd: "quotas.Số lượt khám tại nhà..."),
      // chuẩn hóa lại field và bỏ prefix khỏi message tiếng Việt.
      let cleanMsg = trimmed;
      const nestedPrefixMatch = /^([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)*)\.(.+)$/.exec(trimmed);
      if (nestedPrefixMatch && VIETNAMESE_CHAR_REGEX.test(nestedPrefixMatch[2])) {
        const prefix = nestedPrefixMatch[1];
        cleanMsg = nestedPrefixMatch[2];
        field = this.inferNestedField(prefix, cleanMsg);
      } else if (VIETNAMESE_CHAR_REGEX.test(parts[0] || '')) {
        field = this.inferFieldFromVietnamese(trimmed);
      }

      let issue = ValidationIssue.INVALID_FORMAT;
      const lower = cleanMsg.toLowerCase();
      if (
        lower.includes('should not be empty') ||
        lower.includes('must not be empty') ||
        lower.includes('should not be null or undefined') ||
        lower.includes('không được để trống') ||
        lower.includes('vui lòng cung cấp') ||
        lower.includes('required')
      ) {
        issue = ValidationIssue.REQUIRED;
      } else if (
        lower.includes('must be longer') ||
        lower.includes('minlength') ||
        lower.includes('ít nhất')
      ) {
        issue = ValidationIssue.MIN_LENGTH;
      } else if (
        lower.includes('must be shorter') ||
        lower.includes('maxlength') ||
        lower.includes('vượt quá')
      ) {
        issue = ValidationIssue.MAX_LENGTH;
      } else if (
        lower.includes('must not be less') ||
        lower.includes('must be greater') ||
        lower.includes('lớn hơn') ||
        lower.includes('từ 1 đến') ||
        lower.includes('min')
      ) {
        issue = ValidationIssue.MIN_VALUE;
      } else if (
        lower.includes('must not be greater') ||
        lower.includes('must be less') ||
        lower.includes('không được vượt quá') ||
        lower.includes('max')
      ) {
        issue = ValidationIssue.MAX_VALUE;
      } else if (
        lower.includes('must be an email') ||
        lower.includes('format') ||
        lower.includes('must match') ||
        lower.includes('chữ cái')
      ) {
        issue = ValidationIssue.INVALID_FORMAT;
      } else if (
        lower.includes('must be an integer') ||
        lower.includes('must be a string') ||
        lower.includes('must be a boolean') ||
        lower.includes('must be an object') ||
        lower.includes('must be an array') ||
        lower.includes('must be a number') ||
        lower.includes('phải là số nguyên') ||
        lower.includes('phải là chuỗi')
      ) {
        issue = ValidationIssue.INVALID_TYPE;
      }

      return {
        field,
        issue,
        message: this.translateValidationMessage(field, cleanMsg),
      };
    });
  }

  private inferNestedField(prefix: string, message: string): string {
    const lower = message.toLowerCase();
    if (prefix === 'quotas') {
      if (lower.includes('khám tại nhà')) return 'quotas.homeVisits';
      if (lower.includes('tư vấn video')) return 'quotas.videoConsultations';
    }
    return prefix;
  }

  private inferFieldFromVietnamese(message: string): string {
    const lower = message.toLowerCase();
    if (lower.includes('tên gói')) return 'name';
    if (lower.includes('mô tả gói')) return 'description';
    if (lower.includes('thời hạn gói')) return 'durationMonths';
    if (lower.includes('giá gói trọn kỳ')) return 'priceVnd';
    if (lower.includes('đơn giá lượt khám tại nhà')) return 'homeVisitUnitPriceVnd';
    if (lower.includes('thành viên trong giá gói')) return 'includedMembers';
    if (lower.includes('thành viên tối đa')) return 'maxMembers';
    if (lower.includes('phụ phí thêm thành viên')) return 'additionalMemberMonthlyPriceVnd';
    if (lower.includes('hạn mức khám tại nhà')) return 'quotas';
    if (lower.includes('lượt khám tại nhà')) return 'quotas.homeVisits';
    if (lower.includes('lượt tư vấn video')) return 'quotas.videoConsultations';
    return 'unknown';
  }

  private translateValidationMessage(field: string, msgStr: string): string {
    if (VIETNAMESE_CHAR_REGEX.test(msgStr)) {
      return msgStr;
    }

    const label = this.getFieldLabel(field);
    const lower = msgStr.toLowerCase();

    if (lower.includes('should not exist')) {
      return `Trường ${label} không được phép gửi lên.`;
    }
    if (
      lower.includes('should not be empty') ||
      lower.includes('must not be empty') ||
      lower.includes('should not be null or undefined')
    ) {
      return `${label} không được để trống.`;
    }

    const minLenMatch = /longer than or equal to (\d+) characters/i.exec(msgStr);
    if (minLenMatch) {
      return `${label} phải có ít nhất ${minLenMatch[1]} ký tự.`;
    }

    const maxLenMatch = /shorter than or equal to (\d+) characters/i.exec(msgStr);
    if (maxLenMatch) {
      return `${label} không được vượt quá ${maxLenMatch[1]} ký tự.`;
    }

    const minValMatch = /must not be less than (-?\d+(?:\.\d+)?)/i.exec(msgStr);
    if (minValMatch) {
      return `${label} phải lớn hơn hoặc bằng ${minValMatch[1]}.`;
    }

    const maxValMatch = /must not be greater than (-?\d+(?:\.\d+)?)/i.exec(msgStr);
    if (maxValMatch) {
      return maxValMatch[1] === '0'
        ? `${label} phải bằng 0.`
        : `${label} không được lớn hơn ${maxValMatch[1]}.`;
    }

    if (lower.includes('must be an email')) {
      return `${label} không đúng định dạng email.`;
    }
    if (lower.includes('must be a uuid')) {
      return `${label} phải là mã UUID hợp lệ.`;
    }
    if (lower.includes('must be an integer')) {
      return `${label} phải là số nguyên.`;
    }
    if (lower.includes('must be a number')) {
      return `${label} phải là số hợp lệ.`;
    }
    if (lower.includes('must be a string')) {
      return `${label} phải là chuỗi ký tự.`;
    }
    if (lower.includes('must be a boolean')) {
      return `${label} phải là giá trị đúng/sai.`;
    }
    if (lower.includes('must be an array')) {
      return `${label} phải là danh sách hợp lệ.`;
    }
    if (lower.includes('must be an object')) {
      return `${label} phải là đối tượng dữ liệu hợp lệ.`;
    }
    if (lower.includes('must be one of the following values')) {
      const allowed = msgStr.split(':').slice(1).join(':').trim();
      return allowed
        ? `${label} chỉ chấp nhận một trong các giá trị: ${allowed}.`
        : `${label} có giá trị không hợp lệ.`;
    }
    if (lower.includes('must match')) {
      return `${label} không đúng định dạng yêu cầu.`;
    }

    return `${label} không hợp lệ.`;
  }

  private getFieldLabel(field: string): string {
    return FIELD_LABELS[field] ?? field;
  }

  private ensureVietnameseDetail(raw: string, status: HttpStatus): string {
    const trimmed = (raw || '').trim();
    if (!trimmed) return this.defaultVietnameseMessage(status);
    const known = KNOWN_ENGLISH_MESSAGES[trimmed.toLowerCase()];
    if (known) return known;
    if (VIETNAMESE_CHAR_REGEX.test(trimmed)) return trimmed;
    return this.defaultVietnameseMessage(status);
  }

  private defaultVietnameseMessage(status: HttpStatus): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return 'Yêu cầu không hợp lệ. Vui lòng kiểm tra lại dữ liệu.';
      case HttpStatus.UNAUTHORIZED:
        return 'Phiên đăng nhập đã hết hạn hoặc không hợp lệ. Vui lòng đăng nhập lại.';
      case HttpStatus.FORBIDDEN:
        return 'Bạn không có quyền thực hiện thao tác này.';
      case HttpStatus.NOT_FOUND:
        return 'Không tìm thấy tài nguyên yêu cầu.';
      case HttpStatus.CONFLICT:
        return 'Dữ liệu đang xung đột với trạng thái hiện tại.';
      case HttpStatus.UNPROCESSABLE_ENTITY:
        return 'Dữ liệu đầu vào không hợp lệ.';
      case HttpStatus.TOO_MANY_REQUESTS:
        return 'Bạn đã gửi quá nhiều yêu cầu. Vui lòng thử lại sau.';
      default:
        return 'Hệ thống đang gặp sự cố không mong muốn. Vui lòng thử lại sau.';
    }
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

  public resolveContextualErrorCode(
    status: HttpStatus,
    instanceUrl: string = '',
    resObj?: any,
  ): string {
    if (resObj && typeof resObj === 'object') {
      if (typeof resObj.errorCode === 'string' && resObj.errorCode) {
        return resObj.errorCode;
      }
      if (typeof resObj.code === 'string' && resObj.code) {
        return resObj.code;
      }
    }

    if (instanceUrl) {
      for (const rule of DOMAIN_ROUTE_RULES) {
        if (rule.pattern.test(instanceUrl)) {
          const matched = rule.statusMap[status];
          if (matched) return matched;
        }
      }
    }

    return this.mapStatusToErrorCode(status);
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
