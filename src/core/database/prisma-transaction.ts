import { ConflictException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

// Serializable ngăn hai request cùng đọc trạng thái cũ rồi cùng ghi nhận thanh toán.
// Chỉ retry lỗi xung đột DB; không retry lỗi nghiệp vụ và không gọi HTTP/email trong callback.
export async function serializable<T>(
  prisma: PrismaClient,
  action: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(action, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5000,
        timeout: 10000,
      });
    } catch (error) {
      const databaseError = error as {
        code?: string;
        meta?: { code?: string };
      };
      const code = databaseError.code;
      // SELECT FOR UPDATE qua queryRaw trả P2010 kèm SQLSTATE, khác lỗi Prisma update thông thường.
      const retryable =
        code === 'P2034' ||
        code === 'P2002' ||
        (code === 'P2010' &&
          ['40001', '40P01'].includes(databaseError.meta?.code ?? ''));
      if (retryable && attempt < 2) continue;
      if (retryable) {
        throw new ConflictException(
          'Concurrent update or duplicate record; refresh and retry',
        );
      }
      throw error;
    }
  }
  throw new ConflictException('Concurrent database update');
}

// Tiền lưu DECIMAL trong PostgreSQL; chỉ đổi sang JSON number nếu vẫn chính xác tuyệt đối.
export function moneyToNumber(value: bigint | Prisma.Decimal): number {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount))
    throw new Error('Stored amount exceeds JSON safe integer range');
  return amount;
}
