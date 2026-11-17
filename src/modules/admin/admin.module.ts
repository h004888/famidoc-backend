import { Module } from '@nestjs/common';
import { AuthAccessModule } from '../../core/auth/auth-access.module';
import { AuthModule } from '../auth/auth.module';
import { AdminController, FacilityComplaintsController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [AuthAccessModule, AuthModule],
  controllers: [AdminController, FacilityComplaintsController],
  providers: [AdminService],
})
export class AdminModule {}
