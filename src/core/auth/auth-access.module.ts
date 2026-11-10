import { Inject, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '../database/prisma.module';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';

export interface ICacheStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: any[]): Promise<'OK'>;
  del(...keys: string[]): Promise<number>;
  ttl(key: string): Promise<number>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  mget(...keys: string[]): Promise<(string | null)[]>;
  disconnect?(): void;
  quit?(): Promise<'OK'>;
}

export class InMemoryCacheStore implements ICacheStore {
  private readonly store = new Map<string, { value: string; expireAt?: number }>();

  async get(key: string): Promise<string | null> {
    const item = this.store.get(key);
    if (!item) return null;
    if (item.expireAt && Date.now() > item.expireAt) {
      this.store.delete(key);
      return null;
    }
    return item.value;
  }

  async set(key: string, value: string, ...args: any[]): Promise<'OK'> {
    let expireAt: number | undefined;
    for (let i = 0; i < args.length; i++) {
      if (typeof args[i] === 'string' && args[i].toUpperCase() === 'EX' && args[i + 1]) {
        expireAt = Date.now() + Number(args[i + 1]) * 1000;
        break;
      }
      if (typeof args[i] === 'string' && args[i].toUpperCase() === 'PX' && args[i + 1]) {
        expireAt = Date.now() + Number(args[i + 1]);
        break;
      }
    }
    this.store.set(key, { value: String(value), expireAt });
    return 'OK';
  }

  async del(...keys: string[]): Promise<number> {
    let count = 0;
    const flatKeys = keys.flat();
    for (const key of flatKeys) {
      if (this.store.delete(key)) count++;
    }
    return count;
  }

  async ttl(key: string): Promise<number> {
    const item = this.store.get(key);
    if (!item) return -2;
    if (!item.expireAt) return -1;
    const remainingMs = item.expireAt - Date.now();
    if (remainingMs <= 0) {
      this.store.delete(key);
      return -2;
    }
    return Math.ceil(remainingMs / 1000);
  }

  async incr(key: string): Promise<number> {
    const current = await this.get(key);
    const num = (current ? parseInt(current, 10) : 0) + 1;
    await this.set(key, String(num));
    return num;
  }

  async expire(key: string, seconds: number): Promise<number> {
    const item = this.store.get(key);
    if (!item) return 0;
    item.expireAt = Date.now() + seconds * 1000;
    return 1;
  }

  async mget(...keys: string[]): Promise<(string | null)[]> {
    const flatKeys = keys.flat();
    return Promise.all(flatKeys.map((k) => this.get(k)));
  }

  disconnect() {}
  quit() {
    return Promise.resolve('OK' as const);
  }
}

// Bộ lưu trữ in-memory dùng chung duy nhất cho ứng dụng, không cần cài đặt hoặc kết nối máy chủ Redis bên ngoài.
const inMemoryCacheSingleton = new InMemoryCacheStore();

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
      useValue: inMemoryCacheSingleton,
    },
  ],
  exports: [JwtModule, JwtAuthGuard, RolesGuard, 'REDIS_CLIENT'],
})
export class AuthAccessModule {}
