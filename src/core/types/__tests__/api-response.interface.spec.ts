import {
  isSuccessResponse,
  isErrorResponse,
  ApiSuccessResponse,
  ApiErrorResponse,
} from '../api-response.interface';

describe('ApiResponse Type Guards and Contracts', () => {
  it('isSuccessResponse nên trả về true cho response thành công hợp lệ', () => {
    const successRes: ApiSuccessResponse<{ id: string }> = {
      success: true,
      code: 200,
      message: 'OK',
      data: { id: '123' },
      timestamp: '2026-11-10T08:30:00.000Z',
      requestId: 'req_01',
    };

    expect(isSuccessResponse(successRes)).toBe(true);
    expect(isErrorResponse(successRes)).toBe(false);
  });

  it('isErrorResponse nên trả về true cho response lỗi chuẩn Problem Details', () => {
    const errorRes: ApiErrorResponse = {
      success: false,
      code: 404,
      error: {
        type: 'https://api.famidoc.vn/errors/resource-not-found',
        title: 'Resource Not Found',
        detail: 'User not found',
        errorCode: 'USER_NOT_FOUND',
        instance: '/api/v1/users/123',
      },
      timestamp: '2026-11-10T08:30:00.000Z',
      requestId: 'req_02',
    };

    expect(isErrorResponse(errorRes)).toBe(true);
    expect(isSuccessResponse(errorRes)).toBe(false);
  });

  it('isSuccessResponse và isErrorResponse nên trả về false cho payload không hợp lệ hoặc null/undefined', () => {
    expect(isSuccessResponse(null)).toBe(false);
    expect(isSuccessResponse(undefined)).toBe(false);
    expect(isSuccessResponse({})).toBe(false);
    expect(isErrorResponse(null)).toBe(false);
    expect(isErrorResponse(undefined)).toBe(false);
    expect(isErrorResponse({})).toBe(false);
  });
});
