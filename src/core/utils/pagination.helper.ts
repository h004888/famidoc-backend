import { PaginationMeta } from '../types/api-response.interface';

export interface OffsetPaginationOptions {
  totalRecords: number;
  page?: number;
  pageSize?: number;
}

export class PaginationHelper {
  public static createOffsetPagination(options: OffsetPaginationOptions): PaginationMeta {
    const rawPage = options.page ?? 1;
    const rawPageSize = options.pageSize ?? 20;

    const page = Math.max(1, Math.floor(rawPage));
    const pageSize = Math.max(1, Math.floor(rawPageSize));
    const totalRecords = Math.max(0, Math.floor(options.totalRecords));

    const totalPages = totalRecords > 0 ? Math.ceil(totalRecords / pageSize) : 0;
    const hasNextPage = totalPages > 0 && page < totalPages;
    const hasPreviousPage = page > 1 && totalPages > 0 && page <= totalPages + 1;

    return {
      page,
      pageSize,
      totalRecords,
      totalPages,
      hasNextPage,
      hasPreviousPage,
    };
  }

  public static createCursorPagination(options: {
    pageSize: number;
    hasNextPage: boolean;
    hasPreviousPage?: boolean;
    nextCursor?: string | null;
    previousCursor?: string | null;
  }) {
    return {
      pageSize: Math.max(1, Math.floor(options.pageSize)),
      hasNextPage: options.hasNextPage,
      hasPreviousPage: options.hasPreviousPage ?? false,
      nextCursor: options.nextCursor ?? null,
      previousCursor: options.previousCursor ?? null,
    };
  }
}


export class CursorHelper {
  /**
   * Encodes an object payload into a URL-safe Base64 string.
   */
  public static encode(payload: Record<string, any>): string {
    const jsonStr = JSON.stringify(payload);
    return Buffer.from(jsonStr, 'utf-8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  /**
   * Decodes a URL-safe Base64 string into an object payload.
   */
  public static decode<T = Record<string, any>>(cursor: string): T | null {
    if (!cursor || typeof cursor !== 'string') return null;
    try {
      let base64 = cursor.replace(/-/g, '+').replace(/_/g, '/');
      while (base64.length % 4 !== 0) {
        base64 += '=';
      }
      const jsonStr = Buffer.from(base64, 'base64').toString('utf-8');
      return JSON.parse(jsonStr) as T;
    } catch {
      return null;
    }
  }
}
