import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import Redis from 'ioredis';
import { AuthController } from './controllers/auth.controller';
import { AUTH_REPOSITORY_TOKEN } from './repositories/interfaces/auth.repository.interface';
import { AuthRepositoryImpl } from './repositories/impl/auth.repository.impl';
import { AUTH_SERVICE_TOKEN } from './services/interfaces/auth.service.interface';
import { AuthServiceImpl } from './services/impl/auth.service.impl';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'famidoc_jwt_super_secret_2026',
      signOptions: { expiresIn: '1h' },
    }),
  ],
  controllers: [AuthController],
  providers: [
    { provide: AUTH_REPOSITORY_TOKEN, useClass: AuthRepositoryImpl },
    { provide: AUTH_SERVICE_TOKEN, useClass: AuthServiceImpl },
    {
      provide: 'REDIS_CLIENT',
      useFactory: () => {
        return new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
          lazyConnect: true,
          enableOfflineQueue: false,
        });
      },
    },
    {
      provide: 'MAILER_SERVICE',
      useValue: {
        sendMail: async (options: any) => {
          return true;
        },
      },
    },
  ],
  exports: [AUTH_SERVICE_TOKEN],
})
export class AuthModule {}
