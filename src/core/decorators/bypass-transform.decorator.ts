import { SetMetadata } from '@nestjs/common';

export const BYPASS_TRANSFORM_KEY = 'BYPASS_TRANSFORM';

/**
 * Decorator dùng trên controller hoặc handler để bỏ qua việc tự động bọc Unified Envelope
 * (hữu ích cho các luồng xuất file binary, streaming SSE, hoặc webhook raw response).
 */
export const BypassTransform = () => SetMetadata(BYPASS_TRANSFORM_KEY, true);
