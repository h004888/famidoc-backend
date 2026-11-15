import { Module } from '@nestjs/common';
import { AuthAccessModule } from '../../core/auth/auth-access.module';
import { AuthController } from './controllers/auth.controller';
import { AUTH_REPOSITORY_TOKEN } from './repositories/interfaces/auth.repository.interface';
import { AuthRepositoryImpl } from './repositories/impl/auth.repository.impl';
import { AUTH_SERVICE_TOKEN } from './services/interfaces/auth.service.interface';
import { AuthServiceImpl } from './services/impl/auth.service.impl';

@Module({
  imports: [AuthAccessModule],
  controllers: [AuthController],
  providers: [
    { provide: AUTH_REPOSITORY_TOKEN, useClass: AuthRepositoryImpl },
    { provide: AUTH_SERVICE_TOKEN, useClass: AuthServiceImpl },
  ],
  exports: [AUTH_SERVICE_TOKEN],
})
export class AuthModule {}
