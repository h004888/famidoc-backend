/**
 * IETF RFC 9457 Problem Details & Unified API Response Specifications.
 */

export interface InvalidParamItem {
  field: string;
  issue: string;
  message: string;
  rejectedValue?: any;
}

export interface ProblemDetails {
  type: string;
  title: string;
  detail: string;
  errorCode: string;
  instance?: string;
  invalidParams?: InvalidParamItem[];
  [key: string]: any;
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  totalRecords: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  nextCursor?: string | null;
  previousCursor?: string | null;
}

export interface CursorPaginationMeta {
  pageSize: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  nextCursor: string | null;
  previousCursor: string | null;
}

export interface ResponseMeta {
  pagination?: PaginationMeta | CursorPaginationMeta;
  [key: string]: any;
}

export interface BaseApiResponse {
  code: number;
  message?: string;
  timestamp?: string;
  requestId?: string;
}

export interface ApiSuccessResponse<T = any> extends BaseApiResponse {
  success: true;
  data: T;
  meta?: ResponseMeta | null;
  error?: null;
}

export interface ApiErrorResponse extends BaseApiResponse {
  success: false;
  data?: null;
  meta?: ResponseMeta | null;
  error: ProblemDetails;
}

export type ApiResponse<T = any> = ApiSuccessResponse<T> | ApiErrorResponse;

export function isSuccessResponse<T = any>(res: unknown): res is ApiSuccessResponse<T> {
  if (!res || typeof res !== 'object') return false;
  const candidate = res as Record<string, any>;
  return candidate.success === true && typeof candidate.code === 'number' && 'data' in candidate;
}

export function isErrorResponse(res: unknown): res is ApiErrorResponse {
  if (!res || typeof res !== 'object') return false;
  const candidate = res as Record<string, any>;
  return (
    candidate.success === false &&
    typeof candidate.code === 'number' &&
    candidate.error !== null &&
    typeof candidate.error === 'object' &&
    typeof candidate.error.errorCode === 'string'
  );
}
