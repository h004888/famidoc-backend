import { Module } from '@nestjs/common';
import { PrismaModule } from '../../core/database/prisma.module';
import { AuthAccessModule } from '../../core/auth/auth-access.module';
import { PublicController } from './controllers/public.controller';
import { PublicServiceImpl } from './services/impl/public.service.impl';
import { PUBLIC_SERVICE_TOKEN } from './services/interfaces/public.service.interface';

@Module({
  imports: [PrismaModule, AuthAccessModule],
  controllers: [PublicController],
  providers: [
    {
      provide: PUBLIC_SERVICE_TOKEN,
      useClass: PublicServiceImpl,
    },
  ],
  exports: [PUBLIC_SERVICE_TOKEN],
})
export class PublicModule {}
