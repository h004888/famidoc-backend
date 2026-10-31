import { Module } from '@nestjs/common';
import { AuthAccessModule } from '../../core/auth/auth-access.module';
import { ComplaintsController } from './controllers/complaints.controller';
import { ComplaintsServiceImpl } from './services/impl/complaints.service.impl';
import { COMPLAINTS_SERVICE_TOKEN } from './services/interfaces/complaints.service.interface';
import { ComplaintsRepositoryImpl } from './repositories/impl/complaints.repository.impl';
import { COMPLAINTS_REPOSITORY_TOKEN } from './repositories/interfaces/complaints.repository.interface';
@Module({
  imports: [AuthAccessModule],
  controllers: [ComplaintsController],
  providers: [
    { provide: COMPLAINTS_SERVICE_TOKEN, useClass: ComplaintsServiceImpl },
    {
      provide: COMPLAINTS_REPOSITORY_TOKEN,
      useClass: ComplaintsRepositoryImpl,
    },
  ],
})
export class ComplaintsModule {}
