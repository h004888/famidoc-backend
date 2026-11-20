import { SetMetadata } from '@nestjs/common';

export const RESPONSE_MESSAGE_KEY = 'response_message';

/**
 * Decorator chỉ định thông điệp phản hồi (message) tùy chỉnh cho API endpoint
 * khi trả về thành công trong TransformResponseInterceptor.
 *
 * @example
 * @ResponseMessage('Đăng nhập thành công')
 * @Post('login')
 * login(...) { ... }
 */
export const ResponseMessage = (message: string) =>
  SetMetadata(RESPONSE_MESSAGE_KEY, message);
