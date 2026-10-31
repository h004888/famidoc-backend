import { Inject, Module, type OnModuleDestroy } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import Redis from 'ioredis';
import { PrismaModule } from '../database/prisma.module';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';

@Module({
  imports: [
    PrismaModule,
    JwtModule.registerAsync({
      useFactory: () => {
        const secret = process.env.JWT_SECRET;
        if (!secret || secret.length < 32)
          throw new Error('Configure JWT_SECRET with at least 32 characters');
        return {
          secret,
          signOptions: {
            expiresIn: '1h' as const,
            algorithm: 'HS256' as const,
          },
        };
      },
    }),
  ],
  providers: [
    JwtAuthGuard,
    RolesGuard,
    {
      provide: 'REDIS_CLIENT',
      useFactory: () => {
        // Kết nối ngay khi chạy thật; giới hạn retry để request không treo vô hạn khi Redis tắt.
        const redis = new Redis(
          process.env.REDIS_URL || 'redis://127.0.0.1:6379',
          { maxRetriesPerRequest: 1, connectTimeout: 5000 },
        );
        redis.on('error', () => {
          /* Lỗi sẽ được xử lý tại API; không in URL/mật khẩu ra log. */
        });
        return redis;
      },
    },
  ],
  exports: [JwtModule, JwtAuthGuard, RolesGuard, 'REDIS_CLIENT'],
})
export class AuthAccessModule implements OnModuleDestroy {
  constructor(@Inject('REDIS_CLIENT') private readonly redis: Redis) {}
  onModuleDestroy() {
    this.redis.disconnect();
  }
}
