import { Module } from '@nestjs/common';
import { AuthAccessModule } from '../../core/auth/auth-access.module';
import { OptionalJwtAuthGuard } from '../../core/auth/optional-jwt-auth.guard';
import { PrismaModule } from '../../core/database/prisma.module';
import { MatchingController } from './controllers/matching.controller';
import { DoctorMatchingService } from './services/doctor-matching.service';
import { JevClientService } from './services/jev-client.service';
import { MatchingConfigService } from './services/matching-config.service';

@Module({
  imports: [PrismaModule, AuthAccessModule],
  controllers: [MatchingController],
  providers: [
    MatchingConfigService,
    JevClientService,
    DoctorMatchingService,
    OptionalJwtAuthGuard,
  ],
  exports: [DoctorMatchingService, MatchingConfigService],
})
export class MatchingModule {}
