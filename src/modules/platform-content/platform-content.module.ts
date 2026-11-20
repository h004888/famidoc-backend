import { Module } from '@nestjs/common';
import { PrismaModule } from '../../core/database/prisma.module';
import { AuthAccessModule } from '../../core/auth/auth-access.module';
import { AdminTreatedCasesController } from './controllers/admin-treated-cases.controller';
import { AdminPlatformCareController } from './controllers/admin-platform-care.controller';
import { PlatformContentService } from './services/platform-content.service';

@Module({
  imports: [PrismaModule, AuthAccessModule],
  controllers: [AdminTreatedCasesController, AdminPlatformCareController],
  providers: [PlatformContentService],
  exports: [PlatformContentService],
})
export class PlatformContentModule {}
