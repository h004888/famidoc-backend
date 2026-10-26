import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

// Nơi DUY NHẤT trong dự án được khởi tạo PrismaClient (một connection pool).
// Prisma 7+: truyền driver adapter vào super({ adapter }) theo tài liệu Prisma.
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
