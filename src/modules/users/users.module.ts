import { Module } from '@nestjs/common';
import { AuthAccessModule } from '../../core/auth/auth-access.module';
import { UsersController } from './controllers/users.controller';
import { UsersServiceImpl } from './services/impl/users.service.impl';
import { USERS_SERVICE_TOKEN } from './services/interfaces/users.service.interface';
import { UsersRepositoryImpl } from './repositories/impl/users.repository.impl';
import { USERS_REPOSITORY_TOKEN } from './repositories/interfaces/users.repository.interface';
@Module({
  imports: [AuthAccessModule],
  controllers: [UsersController],
  providers: [
    { provide: USERS_SERVICE_TOKEN, useClass: UsersServiceImpl },
    { provide: USERS_REPOSITORY_TOKEN, useClass: UsersRepositoryImpl },
  ],
})
export class UsersModule {}
