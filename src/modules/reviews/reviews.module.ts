import { Module } from '@nestjs/common';
import { AuthAccessModule } from '../../core/auth/auth-access.module';
import { ReviewsController } from './controllers/reviews.controller';
import { ReviewsServiceImpl } from './services/impl/reviews.service.impl';
import { REVIEWS_SERVICE_TOKEN } from './services/interfaces/reviews.service.interface';
import { ReviewsRepositoryImpl } from './repositories/impl/reviews.repository.impl';
import { REVIEWS_REPOSITORY_TOKEN } from './repositories/interfaces/reviews.repository.interface';
@Module({
  imports: [AuthAccessModule],
  controllers: [ReviewsController],
  providers: [
    { provide: REVIEWS_SERVICE_TOKEN, useClass: ReviewsServiceImpl },
    { provide: REVIEWS_REPOSITORY_TOKEN, useClass: ReviewsRepositoryImpl },
  ],
})
export class ReviewsModule {}
